use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Duration;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager, State, RunEvent, WindowEvent, ipc::Channel};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use futures_util::StreamExt;
use futures_util::future::join_all;

struct AppState {
    active_processes: Mutex<HashMap<u32, CommandChild>>,
    http_client: reqwest::Client,
}

#[derive(Debug, thiserror::Error)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Process error: {0}")]
    Process(String),
    #[error("Security error: {0}")]
    Security(String),
    #[error("HTTP error: {0}")]
    Http(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// ─── Path Security ───

fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string())))
}

fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
    let mut result = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::RootDir => result.push("/"),
            std::path::Component::Prefix(p) => result.push(p.as_os_str()),
            std::path::Component::Normal(c) => result.push(c),
            std::path::Component::ParentDir => { result.pop(); }
            std::path::Component::CurDir => {}
        }
    }
    result
}

fn resolve_path(app: &AppHandle, raw: &str) -> Result<std::path::PathBuf, AppError> {
    let base = app_data_dir(app)?;
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    if raw.starts_with('/') || raw.starts_with('\\') || raw.contains("..") {
        return Err(AppError::Security("Invalid path".into()));
    }
    let target = base.join(relative);
    let normalized = normalize_path(&target);
    let normalized_base = normalize_path(&base);
    if !normalized.starts_with(&normalized_base) {
        return Err(AppError::Security("Path traversal detected".into()));
    }
    Ok(normalized)
}

fn resolve_cwd(app: &AppHandle, raw: &str) -> Result<std::path::PathBuf, AppError> {
    resolve_path(app, raw)
}

// ─── Shell Security ───

const ALLOWED_SHELL_COMMANDS: &[&str] = &[
    "bun", "node", "npx", "git", "ls", "cat", "echo", "mkdir", "rm", "cp", "mv",
    "pwd", "find", "grep", "vite", "npm", "pnpm", "yarn", "tsc", "eslint", "prettier", "touch",
];

// ─── SSRF Protection ───

fn is_private_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    let blocked_prefixes = [
        "http://127.", "https://127.", "http://localhost", "https://localhost",
        "http://0.0.0.0", "https://0.0.0.0", "http://::1", "https://::1",
        "http://10.", "https://10.", "http://192.168.", "https://192.168.",
        "http://169.254.", "https://169.254.",
    ];
    for prefix in &blocked_prefixes {
        if lower.starts_with(prefix) { return true; }
    }
    for protocol in &["http://172.", "https://172."] {
        if let Some(rest) = lower.strip_prefix(protocol) {
            if let Some(octet) = rest.split('.').next() {
                if let Ok(n) = octet.parse::<u8>() {
                    if n >= 16 && n <= 31 { return true; }
                }
            }
        }
    }
    false
}

// ─── Process Management ───

fn spawn_bun_command(
    app: &AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<u32, AppError> {
    let shell = app.shell();
    let mut command = shell.command(cmd);
    for arg in &args {
        command = command.arg(arg);
    }
    let (mut rx, child) = command.current_dir(cwd).spawn().map_err(|e| AppError::Process(e.to_string()))?;

    let pid = child.pid();
    let state = app.state::<AppState>();
    state.active_processes.lock().unwrap().insert(pid, child);

    let app_emit = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let (line, source) = match event {
                CommandEvent::Stdout(buf) => (String::from_utf8_lossy(&buf).to_string(), "stdout"),
                CommandEvent::Stderr(buf) => (String::from_utf8_lossy(&buf).to_string(), "stderr"),
                _ => continue,
            };
            let _ = app_emit.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": source }));
        }
        if let Some(state) = app_emit.try_state::<AppState>() {
            if let Ok(mut processes) = state.active_processes.lock() {
                processes.remove(&pid);
            }
        }
    });

    Ok(pid)
}

#[tauri::command]
async fn bun_dev(cwd: String, port: u16, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command(&app, "bun", vec!["dev".into(), "--port".into(), port.to_string()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn bun_build(cwd: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    // The scaffolded Vite project uses "vite build", not "bun build"
    spawn_bun_command(&app, "bun", vec!["run".into(), "build".into()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn bun_install(cwd: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command(&app, "bun", vec!["install".into()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn run_shell_command(cwd: String, command: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    let parts = shlex::split(&command).ok_or_else(|| AppError::Process("Invalid shell syntax".into()))?;
    if parts.is_empty() {
        return Err(AppError::Process("Empty command".into()));
    }
    if !ALLOWED_SHELL_COMMANDS.contains(&parts[0].as_str()) {
        return Err(AppError::Security(format!("Command '{}' not allowed", parts[0])));
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    spawn_bun_command(&app, &parts[0], args, cwd.to_string_lossy().to_string())
}

#[tauri::command]
async fn kill_process(pid: u32, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut processes = state.active_processes.lock().unwrap();
    if let Some(child) = processes.remove(&pid) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
async fn kill_all_processes(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut processes = state.active_processes.lock().unwrap();
    for (_, child) in processes.drain() {
        let _ = child.kill();
    }
    Ok(())
}

/// Kill any processes listening on the given TCP ports.
/// Uses lsof (unix) or netstat+taskkill (windows) to find and terminate the processes.
#[tauri::command]
async fn kill_port(ports: Vec<u16>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        for port in ports {
            #[cfg(unix)]
            {
                let output = std::process::Command::new("lsof")
                    .args(["-t", &format!("-i:{}", port)])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .output();

                if let Ok(out) = output {
                    let pids = String::from_utf8_lossy(&out.stdout);
                    for pid in pids.lines() {
                        let pid = pid.trim();
                        if pid.is_empty() {
                            continue;
                        }
                        let _ = std::process::Command::new("kill")
                            .args(["-9", pid])
                            .stdout(std::process::Stdio::null())
                            .stderr(std::process::Stdio::null())
                            .output();
                    }
                }
            }

            #[cfg(windows)]
            {
                let output = std::process::Command::new("cmd")
                    .args(["/C", &format!("netstat -ano | findstr :{}", port)])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .output();

                if let Ok(out) = output {
                    let text = String::from_utf8_lossy(&out.stdout);
                    for line in text.lines() {
                        let parts: Vec<&str> = line.split_whitespace().collect();
                        if let Some(pid) = parts.last() {
                            let _ = std::process::Command::new("taskkill")
                                .args(["/PID", pid, "/F"])
                                .stdout(std::process::Stdio::null())
                                .stderr(std::process::Stdio::null())
                                .output();
                        }
                    }
                }
            }
        }
    }).await.map_err(|e| AppError::Process(format!("spawn_blocking error: {e}")))?;

    Ok(())
}

// ─── File System ───

#[derive(serde::Serialize)]
struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

#[tauri::command]
async fn read_dir(path: String, app: AppHandle) -> Result<Vec<FileEntry>, AppError> {
    let base = app_data_dir(&app)?;
    let resolved = resolve_path(&app, &path)?;
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&resolved).await.map_err(AppError::Io)?;
    while let Some(entry) = dir.next_entry().await.map_err(AppError::Io)? {
        let name = entry.file_name().to_string_lossy().to_string();
        let abs_path = entry.path();
        let rel_path = abs_path.strip_prefix(&base).unwrap_or(&abs_path).to_string_lossy().to_string();
        let is_dir = entry.file_type().await.map_err(AppError::Io)?.is_dir();
        entries.push(FileEntry { name, path: rel_path, is_dir });
    }
    Ok(entries)
}

#[tauri::command]
async fn read_file(path: String, app: AppHandle) -> Result<String, AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::read_to_string(&path).await.map_err(AppError::Io)
}

#[tauri::command]
async fn write_file(path: String, content: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    }
    tokio::fs::write(&path, content).await.map_err(AppError::Io)
}

#[tauri::command]
async fn create_dir(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::create_dir_all(&path).await.map_err(AppError::Io)
}

#[tauri::command]
async fn delete_file(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::remove_file(&path).await.map_err(AppError::Io)
}

#[tauri::command]
async fn rename_file(from: String, to: String, app: AppHandle) -> Result<(), AppError> {
    let from = resolve_path(&app, &from)?;
    let to = resolve_path(&app, &to)?;
    tokio::fs::rename(&from, &to).await.map_err(AppError::Io)
}

#[tauri::command]
async fn reveal_in_explorer(path: String, app: AppHandle) -> Result<(), AppError> {
    let resolved = resolve_path(&app, &path)?;
    // For files, open the parent directory. For directories, open the directory itself.
    let target = if resolved.is_file() {
        resolved.parent().map(|p| p.to_path_buf()).unwrap_or(resolved)
    } else {
        resolved
    };
    let target_str = target.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&target_str).spawn().map_err(AppError::Io)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&target_str).spawn().map_err(AppError::Io)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe").arg(&target_str).spawn().map_err(AppError::Io)?;
    Ok(())
}

#[tauri::command]
async fn delete_dir(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::remove_dir_all(&path).await.map_err(AppError::Io)
}

// ─── HTTP Client ───

#[derive(serde::Serialize)]
struct HttpResponse {
    status: u16,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>,
    app: AppHandle,
) -> Result<HttpResponse, AppError> {
    if is_private_url(&url) {
        return Err(AppError::Security("Private/internal URLs are blocked".into()));
    }
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(AppError::Http(format!("Unsupported method: {}", method))),
    };
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = if let Some(b) = body {
        req.body(b).send().await.map_err(|e| AppError::Http(e.to_string()))?
    } else {
        req.send().await.map_err(|e| AppError::Http(e.to_string()))?
    };
    let status = res.status().as_u16();
    let mut res_headers = HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(v) = v.to_str() {
            res_headers.insert(k.to_string(), v.to_string());
        }
    }
    let body = res.text().await.map_err(|e| AppError::Http(e.to_string()))?;
    Ok(HttpResponse { status, headers: res_headers, body })
}

// ─── AI Generation ───

#[derive(serde::Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
    #[serde(default)]
    images: Vec<String>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModel {
    id: String,
    name: String,
    capabilities: Vec<String>,
    family: String,
    families: Vec<String>,
    context_length: Option<u64>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct OllamaModelDetails {
    capabilities: Vec<String>,
    family: String,
    families: Vec<String>,
    context_length: Option<u64>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum CompletionEvent {
    Chunk { text: String, thinking: Option<String> },
    Done,
    Error { message: String },
}

fn detect_provider(model: &str) -> &str {
    if model.contains(":") {
        "ollama"
    } else if model.starts_with("gpt-") || model.starts_with("o1-") || model.starts_with("o3-") {
        "openai"
    } else if model.starts_with("claude-") {
        "claude"
    } else {
        "ollama"
    }
}

async fn chat_completion_ollama(
    client: &reqwest::Client,
    host: &str,
    model: &str,
    messages: &[Message],
    api_key: &str,
    think: Option<bool>,
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
) -> Result<String, AppError> {
    let url = format!("{}/api/chat", host);
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| {
            if m.images.is_empty() {
                serde_json::json!({"role": m.role, "content": m.content})
            } else {
                serde_json::json!({"role": m.role, "content": m.content, "images": m.images})
            }
        })
        .collect();
    let mut body = serde_json::json!({ "model": model, "messages": msgs, "stream": stream });
    if let Some(t) = think {
        body["think"] = serde_json::json!(t);
    }

    let mut req = client.post(&url).json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let res = req.send().await.map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&err_body)
            .ok().and_then(|v| v["error"].as_str().map(String::from))
            .unwrap_or(err_body);
        return Err(AppError::Http(msg));
    }

    if stream {
        let mut full = String::new();

        let mut byte_stream = res.bytes_stream();
        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| AppError::Http(e.to_string()))?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if line.is_empty() { continue; }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                    // Send thinking SEPARATELY from content
                    if let Some(thinking) = json["message"]["thinking"].as_str() {
                        if !thinking.is_empty() {
                            full.push_str(thinking);
                            if let Some(ch) = on_event {
                                let _ = ch.send(CompletionEvent::Chunk { 
                                    text: String::new(), 
                                    thinking: Some(thinking.to_string()) 
                                });
                            }
                        }
                    }

                    // Send content (may come when thinking is done)
                    if let Some(content) = json["message"]["content"].as_str() {
                        if !content.is_empty() {
                            full.push_str(content);
                            if let Some(ch) = on_event {
                                let _ = ch.send(CompletionEvent::Chunk { 
                                    text: content.to_string(), 
                                    thinking: None 
                                });
                            }
                        }
                    }
                }
            }
        }

        // Done streaming
        if let Some(ev) = on_event {
            let _ = ev.send(CompletionEvent::Done);
        }
        Ok(full)
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        let content = json["message"]["content"].as_str().unwrap_or("").to_string();
        Ok(content)
    }
}

async fn chat_completion_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
) -> Result<String, AppError> {
    let url = "https://api.openai.com/v1/chat/completions";
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    let body = serde_json::json!({ "model": model, "messages": msgs, "stream": stream });

    let res = client.post(url)
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&body)
        .send().await.map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&err_body)
            .ok().and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or(err_body);
        return Err(AppError::Http(msg));
    }

    if stream {
        let mut full = String::new();
        let mut byte_stream = res.bytes_stream();
        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| AppError::Http(e.to_string()))?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if data == "[DONE]" { continue; }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        full.push_str(content);
                        if let Some(ev) = on_event {
                            let _ = ev.send(CompletionEvent::Chunk { text: content.to_string(), thinking: None });
                        }
                    }
                }
            }
        }
        if let Some(ev) = on_event {
            let _ = ev.send(CompletionEvent::Done);
        }
        Ok(full)
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        let content = json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string();
        Ok(content)
    }
}

async fn chat_completion_claude(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
) -> Result<String, AppError> {
    let url = "https://api.anthropic.com/v1/messages";
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    let body = serde_json::json!({
        "model": model,
        "messages": msgs,
        "stream": stream,
        "max_tokens": 4096,
    });

    let res = client.post(url)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send().await.map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&err_body)
            .ok().and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or(err_body);
        return Err(AppError::Http(msg));
    }

    if stream {
        let mut full = String::new();
        let mut byte_stream = res.bytes_stream();
        while let Some(chunk_result) = byte_stream.next().await {
            let chunk = chunk_result.map_err(|e| AppError::Http(e.to_string()))?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(text) = json["delta"]["text"].as_str() {
                        full.push_str(text);
                        if let Some(ev) = on_event {
                            let _ = ev.send(CompletionEvent::Chunk { text: text.to_string(), thinking: None });
                        }
                    }
                }
            }
        }
        if let Some(ev) = on_event {
            let _ = ev.send(CompletionEvent::Done);
        }
        Ok(full)
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        let content = json["content"][0]["text"].as_str().unwrap_or("").to_string();
        Ok(content)
    }
}

#[tauri::command]
async fn generate_completion(
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: String,
    app: AppHandle,
) -> Result<String, AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let provider = detect_provider(&model);
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };

    match provider {
        "ollama" => chat_completion_ollama(client, &host, &model, &messages, &api_key, None, false, None).await,
        "openai" => {
            if api_key.is_empty() {
                return Err(AppError::Http("OpenAI API key required".into()));
            }
            chat_completion_openai(client, &api_key, &model, &messages, false, None).await
        }
        "claude" => {
            if api_key.is_empty() {
                return Err(AppError::Http("Claude API key required".into()));
            }
            chat_completion_claude(client, &api_key, &model, &messages, false, None).await
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    }
}

#[tauri::command]
async fn generate_completion_stream(
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: String,
    on_event: Channel<CompletionEvent>,
    think: Option<bool>,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let provider = detect_provider(&model);
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };

    let result = match provider {
        "ollama" => chat_completion_ollama(client, &host, &model, &messages, &api_key, think, true, Some(&on_event)).await,
        "openai" => {
            if api_key.is_empty() {
                return Err(AppError::Http("OpenAI API key required".into()));
            }
            chat_completion_openai(client, &api_key, &model, &messages, true, Some(&on_event)).await
        }
        "claude" => {
            if api_key.is_empty() {
                return Err(AppError::Http("Claude API key required".into()));
            }
            chat_completion_claude(client, &api_key, &model, &messages, true, Some(&on_event)).await
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    };

    if let Err(e) = result {
        let _ = on_event.send(CompletionEvent::Error { message: e.to_string() });
        return Err(e);
    }
    Ok(())
}

/// Parse /api/show response (non-verbose) into OllamaModelDetails.
/// Extracts capabilities, family, families, and context_length from model_info.
fn parse_show_response(json: &serde_json::Value) -> OllamaModelDetails {
    let capabilities = json["capabilities"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let details = &json["details"];
    let family = details["family"].as_str().unwrap_or("").to_string();
    let families = details["families"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    // Extract context_length from model_info — try primary family, then others, then scan
    let context_length = {
        let mi = json.get("model_info");
        let mut found: Option<u64> = None;

        if !family.is_empty() {
            let key = format!("{}.context_length", family);
            found = mi.and_then(|m| m.get(&key)).and_then(|v| v.as_u64());
        }

        if found.is_none() {
            for f in &families {
                if f == &family { continue; }
                let key = format!("{}.context_length", f);
                found = mi.and_then(|m| m.get(&key)).and_then(|v| v.as_u64());
                if found.is_some() { break; }
            }
        }

        if found.is_none() {
            if let Some(mi_obj) = mi.and_then(|v| v.as_object()) {
                for (key, val) in mi_obj {
                    if key.ends_with(".context_length") {
                        if let Some(n) = val.as_u64() {
                            found = Some(n);
                            break;
                        }
                    }
                }
            }
        }

        found
    };

    OllamaModelDetails { capabilities, family, families, context_length }
}

/// Fetch /api/show for a single model and return parsed details.
/// Per docs/api/ollama-openapi.yaml: verbose is optional; even without it,
/// the response includes capabilities, details.family, and model_info (with context_length).
/// Fetch /api/show for a single model and return parsed details.
/// Per docs/api/ollama-openapi.yaml: the default (non-verbose) response includes
/// capabilities, details.family, details.families, and model_info (with context_length).
async fn fetch_model_details(
    client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model_name: &str,
) -> Result<OllamaModelDetails, AppError> {
    let url = format!("{}/api/show", host);
    let body = serde_json::json!({ "model": model_name });

    let mut req = client.post(&url).json(&body);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let res = req.send().await.map_err(|e| {
        AppError::Http(format!("/api/show request failed for {}: {}", model_name, e))
    })?;
    let status = res.status();

    if !status.is_success() {
        let status_code = status.as_u16();
        let err_body = res.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("Ollama /api/show returned HTTP {} for model {}: {}", status_code, model_name, &err_body[..err_body.len().min(200)])));
    }

    // Use .text() + serde_json::from_str() instead of .json() for better error diagnostics.
    // .json() uses serde_json::from_reader which gives generic "error decoding response body".
    let resp_body = res.text().await.map_err(|e| {
        AppError::Http(format!("/api/show body read failed for {}: {}", model_name, e))
    })?;
    let json: serde_json::Value = serde_json::from_str(&resp_body).map_err(|e| {
        AppError::Http(format!("/api/show JSON parse failed for {}: {}", model_name, e))
    })?;
    Ok(parse_show_response(&json))
}

#[tauri::command]
async fn list_ollama_models(host: String, api_key: String, app: AppHandle) -> Result<Vec<OllamaModel>, AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;

    // Default empty host to localhost, then strip trailing slash
    // to avoid double-slash URLs (e.g. http://host//api/show → 301 → POST becomes GET → 405)
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };

    // 1. Fetch model list from /api/tags
    let url = format!("{}/api/tags", host);
    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let res = req.send().await.map_err(|e| AppError::Http(e.to_string()))?;
    let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;

    let model_names: Vec<String> = json["models"].as_array()
        .map(|arr| arr.iter()
            .filter_map(|m| m["name"].as_str().map(String::from))
            .collect())
        .unwrap_or_default();

    if model_names.is_empty() {
        return Ok(vec![]);
    }

    // 2. Fetch /api/show for each model concurrently
    let client_clone = client.clone();
    let host_owned = host.to_string(); // own the trimmed &str for async move
    let detail_futures: Vec<_> = model_names.iter().map(|name| {
        let name = name.clone();
        let host = host_owned.clone();
        let api_key = api_key.clone();
        let client = client_clone.clone();
        async move {
            let detail = fetch_model_details(&client, &host, &api_key, &name).await;
            (name, detail)
        }
    }).collect();

    let results = join_all(detail_futures).await;

    // 3. Merge list + details into OllamaModel structs
    let models: Vec<OllamaModel> = results.into_iter().map(|(name, detail_result)| {
        match detail_result {
            Ok(details) => OllamaModel {
                id: name.clone(),
                name,
                capabilities: details.capabilities,
                family: details.family,
                families: details.families,
                context_length: details.context_length,
            },
            Err(_) => OllamaModel {
                    id: name.clone(),
                    name,
                    capabilities: vec![],
                    family: String::new(),
                    families: vec![],
                    context_length: None,
                },
        }
    }).collect();

    Ok(models)
}

// ─── Export ───

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Io(std::io::Error::new(std::io::ErrorKind::Other, e.to_string()))
}

fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    prefix: &std::path::Path,
) -> Result<(), AppError> {
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let path = entry.path();
        let name = path.strip_prefix(prefix).map_err(|_| AppError::NotFound("Prefix mismatch".into()))?;
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(AppError::Io)?;
            zip.start_file_from_path(name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut file, zip).map_err(AppError::Io)?;
        } else if path.is_dir() {
            zip.add_directory_from_path(name, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            add_dir_to_zip(zip, &path, prefix)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn export_project(
    project_id: String,
    output_path: String,
    format: String,
    include_apis: bool,
    include_theme: bool,
    include_components: bool,
    include_tests: bool,
    app: AppHandle,
) -> Result<String, AppError> {
    let project_dir = resolve_path(&app, &format!("projects/{}", project_id))?;
    // output_path comes from native save dialog — validate it doesn't contain traversal
    if output_path.contains("..") {
        return Err(AppError::Security("Invalid output path".into()));
    }

    let result = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let file = std::fs::File::create(&output_path).map_err(AppError::Io)?;
        let mut zip = zip::ZipWriter::new(file);

        if format == "react-vite" || format.is_empty() {
            let pkg = r#"{"name":"exported-app","private":true,"version":"0.0.0","type":"module","scripts":{"dev":"vite","build":"vite build","preview":"vite preview"},"dependencies":{"react":"^19","react-dom":"^19"},"devDependencies":{"@types/react":"^19","@types/react-dom":"^19","@vitejs/plugin-react":"^4","typescript":"^5","vite":"^6"}}"#;
            zip.start_file("package.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(pkg.as_bytes()).map_err(AppError::Io)?;
            let tsconfig = r#"{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true,"noUnusedLocals":true,"noUnusedParameters":true,"noFallthroughCasesInSwitch":true},"include":["src"],"references":[{"path":"./tsconfig.node.json"}]}"#;
            zip.start_file("tsconfig.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(tsconfig.as_bytes()).map_err(AppError::Io)?;
            let main = r#"import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; ReactDOM.createRoot(document.getElementById('root')!).render(<App />);"#;
            zip.start_file("src/main.tsx", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(main.as_bytes()).map_err(AppError::Io)?;
            let html = r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Exported App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>"#;
            zip.start_file("index.html", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(html.as_bytes()).map_err(AppError::Io)?;
        }

        if include_components {
            let comp_dir = project_dir.join("components");
            if comp_dir.exists() {
                add_dir_to_zip(&mut zip, &comp_dir, &project_dir)?;
            }
        }
        if include_theme {
            let theme_dir = project_dir.join("themes");
            if theme_dir.exists() {
                add_dir_to_zip(&mut zip, &theme_dir, &project_dir)?;
            }
        }
        if include_apis {
            let api_dir = project_dir.join("apis");
            if api_dir.exists() {
                add_dir_to_zip(&mut zip, &api_dir, &project_dir)?;
            }
        }

        let screens_dir = project_dir.join("screens");
        if screens_dir.exists() {
            add_dir_to_zip(&mut zip, &screens_dir, &project_dir)?;
        }

        let gen_dir = project_dir.join("generated");
        if gen_dir.exists() {
            add_dir_to_zip(&mut zip, &gen_dir, &project_dir)?;
        }

        if include_tests {
            let test_setup = r#"import { describe, it, expect } from 'vitest';"#;
            zip.start_file("src/App.test.tsx", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(test_setup.as_bytes()).map_err(AppError::Io)?;
            let vitest_config = r#"import { defineConfig } from 'vitest/config'; import react from '@vitejs/plugin-react'; export default defineConfig({ plugins: [react()], test: { environment: 'jsdom', globals: true } });"#;
            zip.start_file("vitest.config.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(vitest_config.as_bytes()).map_err(AppError::Io)?;
        }

        zip.finish().map_err(zip_err)?;
        Ok(output_path)
    }).await.map_err(|e| AppError::Process(e.to_string()))?;

    result
}

#[tauri::command]
async fn export_component(
    project_id: String,
    component_id: String,
    output_path: String,
    format: String,
    include_types: bool,
    include_storybook: bool,
    include_tests: bool,
    app: AppHandle,
) -> Result<String, AppError> {
    if output_path.contains("..") {
        return Err(AppError::Security("Invalid output path".into()));
    }
    let component_path = resolve_path(&app, &format!("projects/{}/components/{}/component.tsx", project_id, component_id))?;

    let result = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let file = std::fs::File::create(&output_path).map_err(AppError::Io)?;
        let mut zip = zip::ZipWriter::new(file);

        if component_path.exists() {
            let mut f = std::fs::File::open(&component_path).map_err(AppError::Io)?;
            let ext = if format == "jsx" { "jsx" } else { "tsx" };
            zip.start_file(format!("{}.{}", component_id, ext), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut f, &mut zip).map_err(AppError::Io)?;
        }

        if include_types {
            let types = format!("export interface {}Props {{}}\n", component_id);
            zip.start_file(format!("{}.types.ts", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(types.as_bytes()).map_err(AppError::Io)?;
        }

        if include_storybook {
            let story = format!(r#"import type {{ Meta, StoryObj }} from '@storybook/react'; import {{ {} }} from './{}'; const meta: Meta<typeof {}> = {{ component: {} }}; export default meta; type Story = StoryObj<typeof {}>; export const Default: Story = {{ args: {{}} }};"#, component_id, component_id, component_id, component_id, component_id);
            zip.start_file(format!("{}.stories.tsx", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(story.as_bytes()).map_err(AppError::Io)?;
        }

        if include_tests {
            let test = format!(r#"import {{ render, screen }} from '@testing-library/react'; import {{ {} }} from './{}'; describe('{}', () => {{ it('renders', () => {{ render(<{} />); expect(screen.getByText(/.*/)).toBeInTheDocument(); }}); }});"#, component_id, component_id, component_id, component_id);
            zip.start_file(format!("{}.test.tsx", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(test.as_bytes()).map_err(AppError::Io)?;
        }

        zip.finish().map_err(zip_err)?;
        Ok(output_path)
    }).await.map_err(|e| AppError::Process(e.to_string()))?;

    result
}

// ─── Workflows ───

#[tauri::command]
async fn save_workflow(project_id: String, workflow_id: String, data: String, app: AppHandle) -> Result<(), AppError> {
    let dir = resolve_path(&app, &format!("projects/{}/workflows", project_id))?;
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    let path = dir.join(format!("{}.json", workflow_id));
    tokio::fs::write(&path, data).await.map_err(AppError::Io)
}

#[tauri::command]
async fn load_workflow(project_id: String, workflow_id: String, app: AppHandle) -> Result<String, AppError> {
    let path = resolve_path(&app, &format!("projects/{}/workflows/{}.json", project_id, workflow_id))?;
    tokio::fs::read_to_string(&path).await.map_err(AppError::Io)
}

#[tauri::command]
async fn list_workflows(project_id: String, app: AppHandle) -> Result<Vec<FileEntry>, AppError> {
    let base = app_data_dir(&app)?;
    let dir = resolve_path(&app, &format!("projects/{}/workflows", project_id))?;
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir).await.map_err(AppError::Io)?;
    while let Some(entry) = rd.next_entry().await.map_err(AppError::Io)? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") {
            let abs_path = entry.path();
            let rel_path = abs_path.strip_prefix(&base).unwrap_or(&abs_path).to_string_lossy().to_string();
            entries.push(FileEntry { name, path: rel_path, is_dir: false });
        }
    }
    Ok(entries)
}

// ─── App Entry ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 { return attempt.error("too many redirects"); }
            // Preserve method (POST stays POST) on all redirects
            attempt.follow()
        }))
        .build()
        .expect("Failed to build HTTP client");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // tauri_plugin_fs and tauri_plugin_http are initialized for frontend JS API access
        // even though Rust backend uses tokio::fs and reqwest directly for better control
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            active_processes: Mutex::new(HashMap::new()),
            http_client,
        })
        .invoke_handler(tauri::generate_handler![
            bun_dev, bun_build, bun_install, run_shell_command, kill_process, kill_all_processes, kill_port,
            read_dir, read_file, write_file, create_dir, delete_file, delete_dir, rename_file, reveal_in_explorer,
            http_request,
            generate_completion, generate_completion_stream, list_ollama_models,
            export_project, export_component,
            save_workflow, load_workflow, list_workflows,
        ])
        .setup(|_app| {
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<AppState>() {
                    let mut processes = state.active_processes.lock().unwrap();
                    for (_, child) in processes.drain() {
                        let _ = child.kill();
                    }
                }
                // Ensure ports 5173-5184 are freed on app close
                #[cfg(unix)]
                {
                    let _ = std::process::Command::new("sh")
                        .args(["-c", "for port in $(seq 5173 5184); do kill -9 $(lsof -t -i:${port}) 2>/dev/null; done"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("cmd")
                        .args(["/C", "for %p in (5173 5174 5175 5176 5177 5178 5179 5180 5181 5182 5183 5184) do for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :%p') do taskkill /PID %a /F"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                // Additional cleanup if needed
            }
        });
}
