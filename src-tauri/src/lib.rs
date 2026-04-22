use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter, Manager, State, RunEvent, WindowEvent, ipc::Channel};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;
use futures_util::StreamExt;

struct AppState {
    active_processes: Mutex<HashMap<u32, CommandChild>>,
}

#[derive(Debug, thiserror::Error)]
#[allow(dead_code)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Process error: {0}")]
    Process(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

// ─── Process Management ───

fn spawn_bun_command(
    app: AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<u32, String> {
    let shell = app.shell();
    let mut command = shell.command(cmd);
    for arg in &args {
        command = command.arg(arg);
    }
    let (mut rx, child) = command.current_dir(cwd).spawn().map_err(|e| e.to_string())?;

    let pid = child.pid();
    let state = app.state::<Mutex<AppState>>();
    state.lock().unwrap().active_processes.lock().unwrap().insert(pid, child);

    let app_emit = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let line = match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(buf) => String::from_utf8_lossy(&buf).to_string(),
                tauri_plugin_shell::process::CommandEvent::Stderr(buf) => String::from_utf8_lossy(&buf).to_string(),
                _ => continue,
            };
            let _ = app_emit.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": "stdout" }));
        }
    });

    Ok(pid)
}

#[tauri::command]
async fn bun_dev(cwd: String, port: u16, app: AppHandle) -> Result<u32, String> {
    spawn_bun_command(app, "bun", vec!["dev".to_string(), "--port".to_string(), port.to_string()], cwd)
}

#[tauri::command]
async fn bun_build(cwd: String, app: AppHandle) -> Result<u32, String> {
    spawn_bun_command(app, "bun", vec!["build".to_string()], cwd)
}

#[tauri::command]
async fn bun_install(cwd: String, app: AppHandle) -> Result<u32, String> {
    spawn_bun_command(app, "bun", vec!["install".to_string()], cwd)
}

#[tauri::command]
async fn run_shell_command(cwd: String, command: String, app: AppHandle) -> Result<u32, String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    if parts.is_empty() {
        return Err("Empty command".into());
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    spawn_bun_command(app, parts[0], args, cwd)
}

#[tauri::command]
async fn kill_process(pid: u32, state: State<'_, Mutex<AppState>>) -> Result<(), String> {
    let app_state = state.lock().unwrap();
    let mut processes = app_state.active_processes.lock().unwrap();
    if let Some(child) = processes.remove(&pid) {
        child.kill().map_err(|e| e.to_string())?;
    }
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
async fn read_dir(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&path).await.map_err(|e: std::io::Error| e.to_string())?;
    while let Some(entry) = dir.next_entry().await.map_err(|e: std::io::Error| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        let path = entry.path().to_string_lossy().to_string();
        let is_dir = entry.file_type().await.map_err(|e: std::io::Error| e.to_string())?.is_dir();
        entries.push(FileEntry { name, path, is_dir });
    }
    Ok(entries)
}

#[tauri::command]
async fn read_file(path: String) -> Result<String, String> {
    tokio::fs::read_to_string(&path).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn create_dir(path: String) -> Result<(), String> {
    tokio::fs::create_dir_all(&path).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String> {
    tokio::fs::remove_file(&path).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn rename_file(from: String, to: String) -> Result<(), String> {
    tokio::fs::rename(&from, &to).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn delete_dir(path: String) -> Result<(), String> {
    tokio::fs::remove_dir_all(&path).await.map_err(|e: std::io::Error| e.to_string())
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
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "PATCH" => client.patch(&url),
        "DELETE" => client.delete(&url),
        _ => return Err(format!("Unsupported method: {}", method)),
    };
    for (k, v) in headers {
        req = req.header(k, v);
    }
    let res = if let Some(b) = body {
        req.body(b).send().await.map_err(|e: reqwest::Error| e.to_string())?
    } else {
        req.send().await.map_err(|e: reqwest::Error| e.to_string())?
    };
    let status = res.status().as_u16();
    let mut res_headers = HashMap::new();
    for (k, v) in res.headers() {
        if let Ok(v) = v.to_str() {
            res_headers.insert(k.to_string(), v.to_string());
        }
    }
    let body = res.text().await.map_err(|e: reqwest::Error| e.to_string())?;
    Ok(HttpResponse { status, headers: res_headers, body })
}

// ─── AI Generation ───

#[derive(serde::Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}

#[derive(serde::Serialize)]
struct ModelInfo {
    id: String,
    name: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum CompletionEvent {
    Chunk { text: String },
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
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
) -> Result<String, String> {
    let url = format!("{}/api/chat", host);
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    let body = serde_json::json!({ "model": model, "messages": msgs, "stream": stream });

    if stream {
        let res = client.post(&url).json(&body).send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let mut full = String::new();
        let mut stream = res.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| e.to_string())?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if line.is_empty() { continue; }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(line) {
                    if let Some(content) = json["message"]["content"].as_str() {
                        full.push_str(content);
                        if let Some(ev) = on_event {
                            let _ = ev.send(CompletionEvent::Chunk { text: content.to_string() });
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
        let res = client.post(&url).json(&body).send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let text = res.text().await.map_err(|e: reqwest::Error| e.to_string())?;
        Ok(text)
    }
}

async fn chat_completion_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
) -> Result<String, String> {
    let url = "https://api.openai.com/v1/chat/completions";
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    let body = serde_json::json!({ "model": model, "messages": msgs, "stream": stream });

    if stream {
        let res = client.post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let mut full = String::new();
        let mut stream = res.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| e.to_string())?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if data == "[DONE]" { continue; }
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(content) = json["choices"][0]["delta"]["content"].as_str() {
                        full.push_str(content);
                        if let Some(ev) = on_event {
                            let _ = ev.send(CompletionEvent::Chunk { text: content.to_string() });
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
        let res = client.post(url)
            .header("Authorization", format!("Bearer {}", api_key))
            .json(&body)
            .send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let json: serde_json::Value = res.json().await.map_err(|e: reqwest::Error| e.to_string())?;
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
) -> Result<String, String> {
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

    if stream {
        let res = client.post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let mut full = String::new();
        let mut stream = res.bytes_stream();
        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result.map_err(|e| e.to_string())?;
            for line in String::from_utf8_lossy(&chunk).lines() {
                if !line.starts_with("data: ") { continue; }
                let data = &line[6..];
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(text) = json["delta"]["text"].as_str() {
                        full.push_str(text);
                        if let Some(ev) = on_event {
                            let _ = ev.send(CompletionEvent::Chunk { text: text.to_string() });
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
        let res = client.post(url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send().await.map_err(|e: reqwest::Error| e.to_string())?;
        let json: serde_json::Value = res.json().await.map_err(|e: reqwest::Error| e.to_string())?;
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
    _stream: bool,
    _app: AppHandle,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let provider = detect_provider(&model);
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host };

    match provider {
        "ollama" => chat_completion_ollama(&client, &host, &model, &messages, false, None).await,
        "openai" => {
            if api_key.is_empty() {
                return Err("OpenAI API key required".into());
            }
            chat_completion_openai(&client, &api_key, &model, &messages, false, None).await
        }
        "claude" => {
            if api_key.is_empty() {
                return Err("Claude API key required".into());
            }
            chat_completion_claude(&client, &api_key, &model, &messages, false, None).await
        }
        _ => Err("Unsupported provider".into()),
    }
}

#[tauri::command]
async fn generate_completion_stream(
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: String,
    on_event: Channel<CompletionEvent>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let provider = detect_provider(&model);
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host };

    let result = match provider {
        "ollama" => chat_completion_ollama(&client, &host, &model, &messages, true, Some(&on_event)).await,
        "openai" => {
            if api_key.is_empty() {
                return Err("OpenAI API key required".into());
            }
            chat_completion_openai(&client, &api_key, &model, &messages, true, Some(&on_event)).await
        }
        "claude" => {
            if api_key.is_empty() {
                return Err("Claude API key required".into());
            }
            chat_completion_claude(&client, &api_key, &model, &messages, true, Some(&on_event)).await
        }
        _ => Err("Unsupported provider".into()),
    };

    if let Err(e) = result {
        let _ = on_event.send(CompletionEvent::Error { message: e.clone() });
        return Err(e);
    }
    Ok(())
}

#[tauri::command]
async fn list_ollama_models(host: String) -> Result<Vec<ModelInfo>, String> {
    let client = reqwest::Client::new();
    let url = format!("{}/api/tags", host);
    let res = client.get(&url).send().await.map_err(|e: reqwest::Error| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e: reqwest::Error| e.to_string())?;
    let models = json["models"].as_array()
        .map(|arr| arr.iter()
            .filter_map(|m| Some(ModelInfo {
                id: m["name"].as_str()?.to_string(),
                name: m["name"].as_str()?.to_string(),
            }))
            .collect())
        .unwrap_or_default();
    Ok(models)
}

// ─── Export ───

fn add_dir_to_zip<W: std::io::Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    dir: &std::path::Path,
    prefix: &std::path::Path,
) -> Result<(), String> {
    for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = path.strip_prefix(prefix).map_err(|e| e.to_string())?;
        if path.is_file() {
            let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
            zip.start_file_from_path(name, zip::write::SimpleFileOptions::default())
                .map_err(|e| e.to_string())?;
            std::io::copy(&mut file, zip).map_err(|e| e.to_string())?;
        } else if path.is_dir() {
            zip.add_directory_from_path(name, zip::write::SimpleFileOptions::default())
                .map_err(|e| e.to_string())?;
            add_dir_to_zip(zip, &path, prefix)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn export_project(
    project_id: String,
    output_path: String,
    _format: String,
    _include_apis: bool,
    _include_theme: bool,
    _include_components: bool,
    _include_tests: bool,
) -> Result<String, String> {
    let project_dir = std::path::Path::new("./projects").join(&project_id);
    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    add_dir_to_zip(&mut zip, &project_dir, &project_dir)?;
    zip.finish().map_err(|e| e.to_string())?;
    Ok(output_path)
}

#[tauri::command]
async fn export_component(
    _project_id: String,
    component_id: String,
    output_path: String,
    _format: String,
    _include_types: bool,
    _include_storybook: bool,
    _include_tests: bool,
) -> Result<String, String> {
    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipWriter::new(file);
    let component_path = std::path::Path::new("./generated").join("src").join("components").join(format!("{}.tsx", component_id));
    if component_path.exists() {
        let mut f = std::fs::File::open(&component_path).map_err(|e| e.to_string())?;
        zip.start_file(format!("{}.tsx", component_id), zip::write::SimpleFileOptions::default())
            .map_err(|e| e.to_string())?;
        std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(output_path)
}

// ─── Workflows ───

#[tauri::command]
async fn save_workflow(project_id: String, workflow_id: String, data: String) -> Result<(), String> {
    let dir = std::path::Path::new("./projects").join(&project_id).join("workflows");
    tokio::fs::create_dir_all(&dir).await.map_err(|e: std::io::Error| e.to_string())?;
    let path = dir.join(format!("{}.json", workflow_id));
    tokio::fs::write(&path, data).await.map_err(|e: std::io::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn load_workflow(project_id: String, workflow_id: String) -> Result<String, String> {
    let path = std::path::Path::new("./projects").join(&project_id).join("workflows").join(format!("{}.json", workflow_id));
    tokio::fs::read_to_string(&path).await.map_err(|e: std::io::Error| e.to_string())
}

#[tauri::command]
async fn list_workflows(project_id: String) -> Result<Vec<FileEntry>, String> {
    let dir = std::path::Path::new("./projects").join(&project_id).join("workflows");
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir).await.map_err(|e: std::io::Error| e.to_string())?;
    while let Some(entry) = rd.next_entry().await.map_err(|e: std::io::Error| e.to_string())? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") {
            let path = entry.path().to_string_lossy().to_string();
            entries.push(FileEntry { name, path, is_dir: false });
        }
    }
    Ok(entries)
}

// ─── App Entry ───

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState {
            active_processes: Mutex::new(HashMap::new()),
        }))
        .invoke_handler(tauri::generate_handler![
            bun_dev, bun_build, bun_install, run_shell_command, kill_process,
            read_dir, read_file, write_file, create_dir, delete_file, delete_dir, rename_file,
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
                if let Some(state) = window.try_state::<Mutex<AppState>>() {
                    let app_state = state.lock().unwrap();
                    let mut processes = app_state.active_processes.lock().unwrap();
                    for (_, child) in processes.drain() {
                        let _ = child.kill();
                    }
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
