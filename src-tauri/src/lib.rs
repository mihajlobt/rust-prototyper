mod agent;

use std::sync::Mutex;
use std::collections::HashMap;
use std::time::Duration;
use std::io::Write;
use tauri::{AppHandle, Emitter, Manager, State, RunEvent, WindowEvent, ipc::Channel};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use futures_util::StreamExt;
use futures_util::future::join_all;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{
            ChatMessage as OllamaChatMessage,
            request::ChatMessageRequest,
        },
        images::Image,
        parameters::ThinkType,
    },
};

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
    app.path().app_data_dir().map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
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
    "bun", "bunx", "node", "npx", "git", "ls", "cat", "echo", "mkdir", "rm", "cp", "mv",
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
                    if (16..=31).contains(&n) { return true; }
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

/// Runs a whitelisted shell command synchronously — awaits process termination,
/// streams terminal-output events, and returns an error if the exit code is non-zero.
async fn spawn_bun_command_sync(
    app: &AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<(), AppError> {
    let (mut rx, child) = app
        .shell()
        .command(cmd)
        .args(&args)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| AppError::Process(e.to_string()))?;

    let pid = child.pid();
    app.state::<AppState>().active_processes.lock().unwrap().insert(pid, child);

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(buf) => {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": "stdout" }));
            }
            CommandEvent::Stderr(buf) => {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": "stderr" }));
            }
            CommandEvent::Terminated(payload) => {
                app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
                return match payload.code {
                    Some(0) | None => Ok(()),
                    Some(code) => Err(AppError::Process(format!("Process exited with code {code}"))),
                };
            }
            CommandEvent::Error(e) => {
                app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
                return Err(AppError::Process(format!("Process error: {e}")));
            }
            _ => {}
        }
    }

    app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
    Ok(())
}

#[tauri::command]
async fn run_shell_command_sync(cwd: String, command: String, app: AppHandle) -> Result<(), AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    let parts = shlex::split(&command).ok_or_else(|| AppError::Process("Invalid shell syntax".into()))?;
    if parts.is_empty() {
        return Err(AppError::Process("Empty command".into()));
    }
    if !ALLOWED_SHELL_COMMANDS.contains(&parts[0].as_str()) {
        return Err(AppError::Security(format!("Command '{}' not allowed", parts[0])));
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    spawn_bun_command_sync(&app, &parts[0], args, cwd.to_string_lossy().to_string()).await
}

#[tauri::command]
async fn bun_install_sync(cwd: String, app: AppHandle) -> Result<(), AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command_sync(&app, "bun", vec!["install".into()], cwd.to_string_lossy().to_string()).await
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
            kill_port_impl(port);
        }
    }).await.map_err(|e| AppError::Process(format!("spawn_blocking error: {e}")))?;

    Ok(())
}

/// Unix: use lsof with -s TCP:LISTEN so only the server PID is returned,
/// not client PIDs (e.g. the Tauri WebView's open iframe connection).
#[cfg(unix)]
fn kill_port_impl(port: u16) {
    let output = std::process::Command::new("lsof")
        .args(["-t", &format!("-i:{}", port), "-s", "TCP:LISTEN"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    if let Ok(out) = output {
        let pids = String::from_utf8_lossy(&out.stdout);
        for pid in pids.lines() {
            let pid = pid.trim();
            if pid.is_empty() { continue; }
            let _ = std::process::Command::new("kill")
                .args(["-9", pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output();
        }
    }
}

/// Windows: find PID via netstat then taskkill.
#[cfg(windows)]
fn kill_port_impl(port: u16) {
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
    thinking: Option<String>,
    #[serde(default)]
    images: Vec<String>,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CompletionRequest {
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: String,
    provider: String,
    think: Option<bool>,
    output_path: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportProjectOptions {
    include_apis: bool,
    include_theme: bool,
    include_components: bool,
    include_tests: bool,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportComponentOptions {
    include_types: bool,
    include_storybook: bool,
    include_tests: bool,
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
    /// "ollama-local" or "ollama-cloud" — derived from which host was queried
    provider: String,
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
    ToolCall { tool: String, args: serde_json::Value },
    ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
    Done,
    Error { message: String },
}

// ─── ollama-rs helpers ───

/// Parse "http://host:port" or "https://host:port" into (base_url, port).
fn parse_ollama_host(raw: &str) -> (String, u16) {
    let (scheme, rest) = if let Some(s) = raw.strip_prefix("https://") {
        ("https", s)
    } else if let Some(s) = raw.strip_prefix("http://") {
        ("http", s)
    } else {
        ("http", raw)
    };
    if let Some(colon) = rest.rfind(':') {
        let host_part = &rest[..colon];
        if let Ok(port) = rest[colon + 1..].parse::<u16>() {
            return (format!("{}://{}", scheme, host_part), port);
        }
    }
    let default_port = if scheme == "https" { 443u16 } else { 11434u16 };
    (format!("{}://{}", scheme, rest), default_port)
}

fn build_ollama_client(host: &str, api_key: &str) -> Result<Ollama, AppError> {
    let (base_url, port) = parse_ollama_host(host);
    if !api_key.is_empty() {
        use ollama_rs::headers::{HeaderMap, AUTHORIZATION};
        let mut headers = HeaderMap::new();
        let header_val = format!("Bearer {}", api_key)
            .parse()
            .map_err(|_| AppError::Http("Invalid API key format".into()))?;
        headers.insert(AUTHORIZATION, header_val);
        Ok(Ollama::new_with_request_headers(base_url, port, headers))
    } else {
        Ok(Ollama::new(base_url, port))
    }
}

fn to_ollama_messages(messages: &[Message]) -> Vec<OllamaChatMessage> {
    messages.iter().map(|m| {
        let mut msg = match m.role.as_str() {
            "assistant" => OllamaChatMessage::assistant(m.content.clone()),
            "system" => OllamaChatMessage::system(m.content.clone()),
            _ => OllamaChatMessage::user(m.content.clone()),
        };
        // Per Ollama API docs, thinking is part of the message schema and must be
        // included for assistant history messages so thinking continues on subsequent turns.
        msg.thinking = m.thinking.clone();
        if !m.images.is_empty() {
            msg = msg.with_images(m.images.iter().map(|b| Image::from_base64(b.clone())).collect());
        }
        msg
    }).collect()
}

// ─── Ollama streaming via ollama-rs ───

async fn generate_ollama_completion_stream(
    request: &CompletionRequest,
    app_data_dir: &std::path::Path,
    channel: &Channel<CompletionEvent>,
) -> Result<(), AppError> {
    let ollama = build_ollama_client(&request.host, &request.api_key)?;
    let ollama_messages = to_ollama_messages(&request.messages);

    if let Some(path) = request.output_path.as_deref() {
        // ── Agent loop mode: multi-turn tool calling via agent module ─────────
        agent::run_agent_loop(
            &ollama, &request.model, ollama_messages, request.think, app_data_dir, path, channel,
        ).await
    } else {
        // ── Plain streaming mode (no tools) ───────────────────────────────────
        let mut chat_request = ChatMessageRequest::new(request.model.clone(), ollama_messages);
        if let Some(true) = request.think {
            chat_request = chat_request.think(ThinkType::True);
        }

        let mut stream = ollama
            .send_chat_messages_stream(chat_request)
            .await
            .map_err(|e| AppError::Http(e.to_string()))?;

        while let Some(result) = stream.next().await {
            match result {
                Ok(response) => {
                    let thinking = response.message.thinking.filter(|t| !t.is_empty());
                    let text = response.message.content;
                    if thinking.is_some() || !text.is_empty() {
                        let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                    }
                }
                Err(_) => {
                    return Err(AppError::Http("Ollama stream error".into()));
                }
            }
        }

        let _ = channel.send(CompletionEvent::Done);
        Ok(())
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
    provider: String,
    app: AppHandle,
) -> Result<String, AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };

    match provider.as_str() {
        "ollama" => {
            let ollama = build_ollama_client(&host, &api_key)?;
            let ollama_messages = to_ollama_messages(&messages);
            let request = ChatMessageRequest::new(model.clone(), ollama_messages);
            let response = ollama.send_chat_messages(request).await
                .map_err(|e| AppError::Http(e.to_string()))?;
            Ok(response.message.content)
        }
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
    request: CompletionRequest,
    on_event: Channel<CompletionEvent>,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let host = if request.host.is_empty() { "http://localhost:11434".to_string() } else { request.host.trim_end_matches('/').to_string() };
    // Build a normalized request with the defaulted host
    let mut normalized_request = request.clone();
    normalized_request.host = host;

    let app_data = app_data_dir(&app)?;
    let result = match normalized_request.provider.as_str() {
        "ollama" => {
            generate_ollama_completion_stream(
                &normalized_request, &app_data, &on_event,
            ).await.map(|_| String::new())
        }
        "openai" => {
            if normalized_request.api_key.is_empty() {
                return Err(AppError::Http("OpenAI API key required".into()));
            }
            chat_completion_openai(client, &normalized_request.api_key, &normalized_request.model, &normalized_request.messages, true, Some(&on_event)).await
        }
        "claude" => {
            if normalized_request.api_key.is_empty() {
                return Err(AppError::Http("Claude API key required".into()));
            }
            chat_completion_claude(client, &normalized_request.api_key, &normalized_request.model, &normalized_request.messages, true, Some(&on_event)).await
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

    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };
    let provider: String = if host == "https://ollama.com" { "ollama-cloud".to_string() } else { "ollama-local".to_string() };

    // 1. Fetch model list via ollama-rs
    let ollama = build_ollama_client(&host, &api_key)?;
    let local_models = ollama.list_local_models().await.map_err(|e| AppError::Http(e.to_string()))?;
    let model_names: Vec<String> = local_models.iter().map(|m| m.name.clone()).collect();

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
                provider: provider.clone(),
            },
            Err(_) => OllamaModel {
                    id: name.clone(),
                    name,
                    capabilities: vec![],
                    family: String::new(),
                    families: vec![],
                    context_length: None,
                    provider: provider.clone(),
                },
        }
    }).collect();

    Ok(models)
}

// ─── Export ───

fn zip_err(e: zip::result::ZipError) -> AppError {
    AppError::Io(std::io::Error::other(e.to_string()))
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

/// Add a single file to the ZIP at the given path, reading from disk.
fn add_file_to_zip<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    source_path: &std::path::Path,
    zip_path: &str,
) -> Result<(), AppError> {
    if !source_path.exists() {
        return Ok(()); // Skip missing files silently
    }
    let mut file = std::fs::File::open(source_path).map_err(AppError::Io)?;
    zip.start_file(zip_path, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
    std::io::copy(&mut file, zip).map_err(AppError::Io)?;
    Ok(())
}

/// Add a directory and all its contents to the ZIP, rooted at `zip_prefix`.
/// Files under `dir` appear under `zip_prefix/` in the ZIP.
fn add_dir_to_zip_with_prefix<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    zip_prefix: &str,
) -> Result<(), AppError> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(AppError::Io)? {
        let entry = entry.map_err(AppError::Io)?;
        let path = entry.path();
        let file_name = path.file_name().unwrap_or_default().to_string_lossy();
        let zip_entry = format!("{}/{}", zip_prefix, file_name);
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(AppError::Io)?;
            zip.start_file(&zip_entry, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut file, zip).map_err(AppError::Io)?;
        } else if path.is_dir() {
            zip.add_directory(&zip_entry, zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            add_dir_to_zip_with_prefix(zip, &path, &zip_entry)?;
        }
    }
    Ok(())
}

/// Scan TypeScript/TSX source code for `@/components/ui/{name}` imports
/// and return a deduplicated list of component names (e.g., "button", "card").
fn scan_shadcn_imports(source: &str) -> Vec<String> {
    let prefix = "@/components/ui/";
    let mut names = Vec::new();
    for line in source.lines() {
        let trimmed = line.trim();
        if let Some(idx) = trimmed.find(prefix) {
            let after = &trimmed[idx + prefix.len()..];
            // Find the closing quote — look for ' or " whichever comes first
            let component_path = after
                .find('\'')
                .or_else(|| after.find('"'))
                .or_else(|| after.find(';'))
                .map(|end| &after[..end])
                .unwrap_or(after);
            // Take just the first segment (e.g., "button" from "button" or "button/index")
            let base_name = component_path.split('/').next().unwrap_or(component_path);
            if !base_name.is_empty() && !names.iter().any(|n| n == base_name) {
                names.push(base_name.to_string());
            }
        }
    }
    names
}

/// shadcn CSS variables for theming — injected into the exported project's globals.css
fn shadcn_globals_css() -> &'static str {
    r#"@import "tailwindcss";

@custom-variant dark (&:where(.dark, .dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --font-sans: 'Inter', sans-serif;
  --font-mono: var(--font-geist-mono, monospace);
}

@layer base {
  :root {
    --background: oklch(1 0 0);
    --foreground: oklch(0.145 0 0);
    --card: oklch(1 0 0);
    --card-foreground: oklch(0.145 0 0);
    --popover: oklch(1 0 0);
    --popover-foreground: oklch(0.145 0 0);
    --primary: oklch(0.205 0 0);
    --primary-foreground: oklch(0.985 0 0);
    --secondary: oklch(0.97 0 0);
    --secondary-foreground: oklch(0.205 0 0);
    --muted: oklch(0.97 0 0);
    --muted-foreground: oklch(0.556 0 0);
    --accent: oklch(0.97 0 0);
    --accent-foreground: oklch(0.205 0 0);
    --destructive: oklch(0.577 0.245 27.325);
    --border: oklch(0.922 0 0);
    --input: oklch(0.922 0 0);
    --ring: oklch(0.708 0 0);
    --radius: 0.625rem;
    --chart-1: oklch(0.646 0.222 41.116);
    --chart-2: oklch(0.6 0.118 184.704);
    --chart-3: oklch(0.398 0.07 227.392);
    --chart-4: oklch(0.828 0.189 84.429);
    --chart-5: oklch(0.769 0.188 70.08);
    --sidebar: oklch(0.985 0 0);
    --sidebar-foreground: oklch(0.145 0 0);
    --sidebar-primary: oklch(0.205 0 0);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.97 0 0);
    --sidebar-accent-foreground: oklch(0.205 0 0);
    --sidebar-border: oklch(0.922 0 0);
    --sidebar-ring: oklch(0.708 0 0);
  }

  .dark {
    --background: oklch(0.145 0 0);
    --foreground: oklch(0.985 0 0);
    --card: oklch(0.145 0 0);
    --card-foreground: oklch(0.985 0 0);
    --popover: oklch(0.145 0 0);
    --popover-foreground: oklch(0.985 0 0);
    --primary: oklch(0.985 0 0);
    --primary-foreground: oklch(0.205 0 0);
    --secondary: oklch(0.269 0 0);
    --secondary-foreground: oklch(0.985 0 0);
    --muted: oklch(0.269 0 0);
    --muted-foreground: oklch(0.708 0 0);
    --accent: oklch(0.269 0 0);
    --accent-foreground: oklch(0.985 0 0);
    --destructive: oklch(0.396 0.141 25.723);
    --border: oklch(0.269 0 0);
    --input: oklch(0.269 0 0);
    --ring: oklch(0.439 0 0);
    --chart-1: oklch(0.488 0.243 264.376);
    --chart-2: oklch(0.696 0.17 162.48);
    --chart-3: oklch(0.769 0.188 70.08);
    --chart-4: oklch(0.627 0.265 303.9);
    --chart-5: oklch(0.645 0.246 16.439);
    --sidebar: oklch(0.205 0 0);
    --sidebar-foreground: oklch(0.985 0 0);
    --sidebar-primary: oklch(0.488 0.243 264.376);
    --sidebar-primary-foreground: oklch(0.985 0 0);
    --sidebar-accent: oklch(0.269 0 0);
    --sidebar-accent-foreground: oklch(0.985 0 0);
    --sidebar-border: oklch(0.269 0 0);
    --sidebar-ring: oklch(0.439 0 0);
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
"#
}

#[tauri::command]
async fn export_project(
    project_id: String,
    output_path: String,
    format: String,
    options: ExportProjectOptions,
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
            // Package JSON with shadcn dependencies
            let pkg = r#"{"name":"exported-app","private":true,"version":"0.0.0","type":"module","scripts":{"dev":"vite","build":"vite build","preview":"vite preview"},"dependencies":{"react":"^19","react-dom":"^19","class-variance-authority":"^0.7","clsx":"^2.1","tailwind-merge":"^3.0","radix-ui":"^1.4","lucide-react":"^0.511"},"devDependencies":{"@tailwindcss/vite":"^4","@types/react":"^19","@types/react-dom":"^19","@vitejs/plugin-react":"^4","typescript":"^5","vite":"^6"}}"#;
            zip.start_file("package.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(pkg.as_bytes()).map_err(AppError::Io)?;

            // TypeScript config with path aliases for @/ imports
            let tsconfig = r#"{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true,"noUnusedLocals":true,"noUnusedParameters":true,"noFallthroughCasesInSwitch":true,"baseUrl":".","paths":{"@/*":["./src/*"]}},"include":["src"],"references":[{"path":"./tsconfig.node.json"}]}"#;
            zip.start_file("tsconfig.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(tsconfig.as_bytes()).map_err(AppError::Io)?;

            // Vite config with path alias resolve
            let vite_config = r#"import { defineConfig } from 'vite'; import react from '@vitejs/plugin-react'; import tailwindcss from '@tailwindcss/vite'; import path from 'path'; export default defineConfig({ plugins: [react(), tailwindcss()], resolve: { alias: { '@': path.resolve(__dirname, './src') } } });"#;
            zip.start_file("vite.config.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(vite_config.as_bytes()).map_err(AppError::Io)?;

            let main = r#"import React from 'react'; import ReactDOM from 'react-dom/client'; import App from './App'; import './styles/globals.css'; ReactDOM.createRoot(document.getElementById('root')!).render(<App />);"#;
            zip.start_file("src/main.tsx", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(main.as_bytes()).map_err(AppError::Io)?;

            let html = r#"<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Exported App</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>"#;
            zip.start_file("index.html", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(html.as_bytes()).map_err(AppError::Io)?;

            // shadcn utility — prefer component-preview's file, fall back to default
            let utils_source = {
                let utils_path = project_dir.join("component-preview").join("src").join("lib").join("utils.ts");
                if utils_path.exists() {
                    std::fs::read_to_string(&utils_path).unwrap_or_else(|_| {
                        r#"import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }"#.to_string()
                    })
                } else {
                    r#"import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }"#.to_string()
                }
            };
            zip.start_file("src/lib/utils.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(utils_source.as_bytes()).map_err(AppError::Io)?;

            // Write the shadcn globals.css with CSS variables
            let globals = shadcn_globals_css();
            zip.start_file("src/styles/globals.css", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(globals.as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_components {
            let comp_dir = project_dir.join("components");
            if comp_dir.exists() {
                add_dir_to_zip(&mut zip, &comp_dir, &project_dir)?;
            }
        }
        if options.include_theme {
            let theme_dir = project_dir.join("themes");
            if theme_dir.exists() {
                add_dir_to_zip(&mut zip, &theme_dir, &project_dir)?;
            }
        }
        if options.include_apis {
            let api_dir = project_dir.join("apis");
            if api_dir.exists() {
                add_dir_to_zip(&mut zip, &api_dir, &project_dir)?;
            }
        }

        // Include shadcn component files from component-preview if available
        let component_preview_dir = project_dir.join("component-preview");
        if component_preview_dir.exists() && (format == "react-vite" || format.is_empty()) {
            let ui_dir = component_preview_dir.join("src").join("components").join("ui");
            if ui_dir.exists() {
                add_dir_to_zip_with_prefix(&mut zip, &ui_dir, "src/components/ui")?;
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

        if options.include_tests {
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
    options: ExportComponentOptions,
    app: AppHandle,
) -> Result<String, AppError> {
    if output_path.contains("..") {
        return Err(AppError::Security("Invalid output path".into()));
    }
    let component_path = resolve_path(&app, &format!("projects/{}/components/{}/component.tsx", project_id, component_id))?;
    let project_dir = resolve_path(&app, &format!("projects/{}", project_id))?;
    let component_preview_dir = project_dir.join("component-preview");

    let result = tokio::task::spawn_blocking(move || -> Result<String, AppError> {
        let file = std::fs::File::create(&output_path).map_err(AppError::Io)?;
        let mut zip = zip::ZipWriter::new(file);

        // Read component source to scan for shadcn imports
        let mut component_source = String::new();
        let ext = if format == "jsx" { "jsx" } else { "tsx" };

        if component_path.exists() {
            let mut f = std::fs::File::open(&component_path).map_err(AppError::Io)?;
            std::io::Read::read_to_string(&mut f, &mut component_source).map_err(AppError::Io)?;
            // Re-open for copying into ZIP
            let mut f = std::fs::File::open(&component_path).map_err(AppError::Io)?;
            zip.start_file(format!("{}.{}", component_id, ext), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            std::io::copy(&mut f, &mut zip).map_err(AppError::Io)?;
        }

        // Scan for shadcn component imports and include referenced files
        let shadcn_components = scan_shadcn_imports(&component_source);
        let has_shadcn_deps = !shadcn_components.is_empty();

        if has_shadcn_deps {
            // Include referenced shadcn component files
            let ui_dir = component_preview_dir.join("src").join("components").join("ui");
            for comp_name in &shadcn_components {
                let comp_file = ui_dir.join(format!("{}.tsx", comp_name));
                let zip_path = format!("components/ui/{}.tsx", comp_name);
                add_file_to_zip(&mut zip, &comp_file, &zip_path)?;
            }

            // Include lib/utils.ts — prefer component-preview's file, fall back to default
            let utils_file = component_preview_dir.join("src").join("lib").join("utils.ts");
            let default_utils = r#"import { clsx, type ClassValue } from "clsx"; import { twMerge } from "tailwind-merge"; export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }"#;
            if utils_file.exists() {
                add_file_to_zip(&mut zip, &utils_file, "lib/utils.ts")?;
            } else {
                zip.start_file("lib/utils.ts", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
                zip.write_all(default_utils.as_bytes()).map_err(AppError::Io)?;
            }

            // Include shadcn globals.css
            let globals_css = shadcn_globals_css();
            zip.start_file("styles/globals.css", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(globals_css.as_bytes()).map_err(AppError::Io)?;

            // Build package.json with shadcn dependencies
            let base_deps = serde_json::json!({
                "react": "^19",
                "react-dom": "^19",
                "class-variance-authority": "^0.7",
                "clsx": "^2.1",
                "tailwind-merge": "^3.0",
                "radix-ui": "^1.4",
                "lucide-react": "^0.511"
            });
            let pkg = serde_json::json!({
                "name": "exported-component",
                "private": true,
                "version": "0.0.0",
                "type": "module",
                "dependencies": base_deps,
                "devDependencies": {
                    "@types/react": "^19",
                    "@types/react-dom": "^19",
                    "typescript": "^5"
                }
            });
            let pkg_str = serde_json::to_string_pretty(&pkg).unwrap_or_default();
            zip.start_file("package.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(pkg_str.as_bytes()).map_err(AppError::Io)?;

            // Include tsconfig.json with path aliases for @/ imports
            let tsconfig = r#"{"compilerOptions":{"target":"ES2020","useDefineForClassFields":true,"lib":["ES2020","DOM","DOM.Iterable"],"module":"ESNext","skipLibCheck":true,"moduleResolution":"bundler","allowImportingTsExtensions":true,"resolveJsonModule":true,"isolatedModules":true,"noEmit":true,"jsx":"react-jsx","strict":true,"noUnusedLocals":true,"noUnusedParameters":true,"noFallthroughCasesInSwitch":true,"baseUrl":".","paths":{"@/*":["./*"]}},"include":["*"]}"#;
            zip.start_file("tsconfig.json", zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(tsconfig.as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_types {
            let types = format!("export interface {}Props {{}}\n", component_id);
            zip.start_file(format!("{}.types.ts", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(types.as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_storybook {
            let story = format!(r#"import type {{ Meta, StoryObj }} from '@storybook/react'; import {{ {} }} from './{}'; const meta: Meta<typeof {}> = {{ component: {} }}; export default meta; type Story = StoryObj<typeof {}>; export const Default: Story = {{ args: {{}} }};"#, component_id, component_id, component_id, component_id, component_id);
            zip.start_file(format!("{}.stories.tsx", component_id), zip::write::SimpleFileOptions::default()).map_err(zip_err)?;
            zip.write_all(story.as_bytes()).map_err(AppError::Io)?;
        }

        if options.include_tests {
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
            bun_dev, bun_build, bun_install, bun_install_sync, run_shell_command, run_shell_command_sync, kill_process, kill_all_processes, kill_port,
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
