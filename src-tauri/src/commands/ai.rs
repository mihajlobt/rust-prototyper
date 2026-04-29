use futures_util::StreamExt;
use futures_util::future::join_all;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager};
use tauri::ipc::Channel;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{ChatMessage as OllamaChatMessage, request::ChatMessageRequest},
        images::Image,
    },
};
use tokio_util::sync::CancellationToken;
use crate::{AppState, AppError, app_data_dir};
use super::ai_providers::{chat_completion_openai, chat_completion_claude};

// ─── Shared types ─────────────────────────────────────────────────────────────

#[derive(serde::Deserialize, Clone)]
pub struct Message {
    pub role: String,
    pub content: String,
    pub thinking: Option<String>,
    #[serde(default)]
    pub images: Vec<String>,
    /// Tool calls made by the assistant — Ollama provider only.
    /// Matches the Ollama API "tool_calls" field format:
    /// https://github.com/ollama/ollama/blob/main/docs/api.md
    #[serde(default)]
    pub tool_calls: Vec<ollama_rs::generation::tools::ToolCall>,
    /// Tool name for tool-role messages — Ollama provider only.
    pub tool_name: Option<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
pub enum CompletionEvent {
    Chunk { text: String, thinking: Option<String> },
    ToolCall { tool: String, args: serde_json::Value },
    ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
    Done,
    Error { message: String },
}

// ─── Request / response types ─────────────────────────────────────────────────

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct OllamaOptions {
    pub temperature: Option<f32>,
    pub top_k: Option<u32>,
    pub top_p: Option<f32>,
    pub num_ctx: Option<u64>,
    pub num_predict: Option<i32>,
    pub repeat_penalty: Option<f32>,
    pub repeat_last_n: Option<i32>,
    pub seed: Option<i32>,
    pub mirostat: Option<u8>,
    pub mirostat_tau: Option<f32>,
    pub mirostat_eta: Option<f32>,
    pub tfs_z: Option<f32>,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub options: OllamaOptions,
}

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub host: String,
    pub api_key: String,
    pub provider: String,
    pub think: Option<bool>,
    pub output_path: Option<String>,
    pub options: Option<OllamaOptions>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaModel {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub family: String,
    pub families: Vec<String>,
    pub context_length: Option<u64>,
    pub provider: String,
}

struct OllamaModelDetails {
    capabilities: Vec<String>,
    family: String,
    families: Vec<String>,
    context_length: Option<u64>,
}

// ─── Ollama helpers ───────────────────────────────────────────────────────────

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

pub(crate) fn build_ollama_client(host: &str, api_key: &str) -> Result<Ollama, AppError> {
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

/// Convert frontend messages to JSON values suitable for the Ollama /api/chat endpoint.
/// Handles tool_calls in assistant messages and tool_name in tool role messages
/// per the Ollama API format:
/// https://github.com/ollama/ollama/blob/main/docs/api.md
///
/// The ollama-rs ChatMessage type lacks a `tool_name` field, so we build
/// raw JSON instead to support the full multi-turn tool calling format.
pub(crate) fn messages_to_ollama_json(messages: &[Message]) -> Vec<serde_json::Value> {
    messages.iter().map(|m| {
        let mut obj = serde_json::Map::new();
        obj.insert("role".to_string(), serde_json::Value::String(m.role.clone()));
        obj.insert("content".to_string(), serde_json::Value::String(m.content.clone()));

        if let Some(thinking) = &m.thinking {
            obj.insert("thinking".to_string(), serde_json::Value::String(thinking.clone()));
        }

        if !m.images.is_empty() {
            obj.insert("images".to_string(), serde_json::Value::Array(
                m.images.iter().map(|b| serde_json::Value::String(b.clone())).collect()
            ));
        }

        // Assistant messages with tool_calls
        if m.role == "assistant" && !m.tool_calls.is_empty() {
            obj.insert("tool_calls".to_string(), serde_json::to_value(&m.tool_calls).unwrap_or_default());
        }

        // Tool role messages must include tool_name per Ollama API docs:
        // {"role": "tool", "tool_name": "write_file", "content": "..."}
        if m.role == "tool" {
            if let Some(tool_name) = &m.tool_name {
                obj.insert("tool_name".to_string(), serde_json::Value::String(tool_name.clone()));
            }
        }

        serde_json::Value::Object(obj)
    }).collect()
}

// ─── Ollama streaming ─────────────────────────────────────────────────────────

/// Monotonically increasing counter for assigning unique request IDs.
static NEXT_REQUEST_ID: AtomicU32 = AtomicU32::new(1);

/// Convert frontend messages to ollama-rs ChatMessage for the agent loop path.
/// The agent loop manages its own history internally and doesn't need tool_name.
fn to_ollama_messages(messages: &[Message]) -> Vec<OllamaChatMessage> {
    messages.iter().map(|m| {
        let mut msg = match m.role.as_str() {
            "assistant" => OllamaChatMessage::assistant(m.content.clone()),
            "system" => OllamaChatMessage::system(m.content.clone()),
            _ => OllamaChatMessage::user(m.content.clone()),
        };
        msg.thinking = m.thinking.clone();
        if !m.images.is_empty() {
            msg = msg.with_images(m.images.iter().map(|b| Image::from_base64(b.clone())).collect());
        }
        msg
    }).collect()
}

async fn generate_ollama_completion_stream(
    request: &CompletionRequest,
    app_data_dir: &std::path::Path,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    http_client: &reqwest::Client,
) -> Result<(), AppError> {
    if let Some(path) = request.output_path.as_deref() {
        // Agent loop path: uses ollama-rs directly (manages its own history)
        let ollama = build_ollama_client(&request.host, &request.api_key)?;
        let ollama_messages = to_ollama_messages(&request.messages);
        crate::agent::run_agent_loop(crate::agent::AgentLoopParams {
            ollama: &ollama,
            model: &request.model,
            initial_messages: ollama_messages,
            think: request.think,
            app_data_dir,
            output_path: path,
            channel,
            cancel_token,
        }).await
    } else {
        // Direct HTTP path: builds raw JSON messages to support tool_name
        // in tool role messages, which ollama-rs ChatMessage doesn't support.
        // Per Ollama API docs:
        // https://github.com/ollama/ollama/blob/main/docs/api.md
        let json_messages = messages_to_ollama_json(&request.messages);

        let mut body = serde_json::json!({
            "model": request.model,
            "messages": json_messages,
            "stream": true,
        });

        if let Some(true) = request.think {
            body["think"] = serde_json::Value::Bool(true);
        }

        if let Some(opts) = &request.options {
            let mut options_obj = serde_json::Map::new();
            if let Some(v) = opts.temperature    { options_obj.insert("temperature".into(), serde_json::json!(v)); }
            if let Some(v) = opts.top_k          { options_obj.insert("top_k".into(), serde_json::json!(v)); }
            if let Some(v) = opts.top_p          { options_obj.insert("top_p".into(), serde_json::json!(v)); }
            if let Some(v) = opts.num_ctx        { options_obj.insert("num_ctx".into(), serde_json::json!(v)); }
            if let Some(v) = opts.num_predict    { options_obj.insert("num_predict".into(), serde_json::json!(v)); }
            if let Some(v) = opts.repeat_penalty { options_obj.insert("repeat_penalty".into(), serde_json::json!(v)); }
            if let Some(v) = opts.repeat_last_n  { options_obj.insert("repeat_last_n".into(), serde_json::json!(v)); }
            if let Some(v) = opts.seed           { options_obj.insert("seed".into(), serde_json::json!(v)); }
            if let Some(v) = opts.mirostat       { options_obj.insert("mirostat".into(), serde_json::json!(v)); }
            if let Some(v) = opts.mirostat_tau   { options_obj.insert("mirostat_tau".into(), serde_json::json!(v)); }
            if let Some(v) = opts.mirostat_eta   { options_obj.insert("mirostat_eta".into(), serde_json::json!(v)); }
            if let Some(v) = opts.tfs_z          { options_obj.insert("tfs_z".into(), serde_json::json!(v)); }
            body["options"] = serde_json::Value::Object(options_obj);
        }

        let url = format!("{}/api/chat", request.host);
        let mut req_builder = http_client.post(&url).json(&body);
        if !request.api_key.is_empty() {
            req_builder = req_builder.header("Authorization", format!("Bearer {}", request.api_key));
        }

        let res = req_builder.send().await.map_err(|e| AppError::Http(e.to_string()))?;
        if !res.status().is_success() {
            let err_body = res.text().await.unwrap_or_default();
            return Err(AppError::Http(err_body));
        }

        let mut byte_stream = res.bytes_stream();
        let mut buffer = String::new();

        loop {
            tokio::select! {
                chunk_result = byte_stream.next() => {
                    match chunk_result {
                        Some(Ok(chunk)) => {
                            if let Ok(chunk_str) = String::from_utf8(chunk.to_vec()) {
                                buffer.push_str(&chunk_str);
                                // Process complete newline-delimited JSON lines
                                let mut start = 0;
                                while let Some(pos) = buffer[start..].find('\n') {
                                    let line = buffer[start..start + pos].trim().to_string();
                                    start = start + pos + 1;
                                    if line.is_empty() { continue; }
                                    if let Ok(response) = serde_json::from_str::<OllamaStreamChunk>(&line) {
                                        let thinking = response.message.thinking.filter(|t| !t.is_empty());
                                        let text = response.message.content;
                                        if thinking.is_some() || !text.is_empty() {
                                            let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                                        }
                                        if response.done {
                                            let _ = channel.send(CompletionEvent::Done);
                                            return Ok(());
                                        }
                                    }
                                }
                                buffer = buffer[start..].to_string();
                            }
                        }
                        Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                        None => {
                            let _ = channel.send(CompletionEvent::Done);
                            return Ok(());
                        }
                    }
                }
                _ = cancel_token.cancelled() => {
                    // Cancellation requested — dropping the byte stream closes
                    // the HTTP connection. Per Ollama API docs there is no
                    // /api/abort endpoint; dropping the connection is the
                    // standard way to stop generation:
                    // https://github.com/ollama/ollama/blob/main/docs/api.md
                    drop(byte_stream);
                    let _ = channel.send(CompletionEvent::Done);
                    return Ok(());
                }
            }
        }
    }
}

/// Minimal struct for deserializing the Ollama /api/chat streaming response.
/// Only the fields we need — role, content, thinking, done.
#[derive(serde::Deserialize)]
struct OllamaStreamChunk {
    message: OllamaStreamMessage,
    done: bool,
}

#[derive(serde::Deserialize)]
struct OllamaStreamMessage {
    content: String,
    thinking: Option<String>,
}

// ─── Model listing ────────────────────────────────────────────────────────────

fn parse_show_response(json: &serde_json::Value) -> OllamaModelDetails {
    let capabilities = json["capabilities"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let details = &json["details"];
    let family = details["family"].as_str().unwrap_or("").to_string();
    let families = details["families"].as_array()
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();

    let context_length = {
        let mi = json.get("model_info");
        let mut found: Option<u64> = None;
        if !family.is_empty() {
            found = mi.and_then(|m| m.get(format!("{}.context_length", family).as_str())).and_then(|v| v.as_u64());
        }
        if found.is_none() {
            for f in &families {
                if f == &family { continue; }
                found = mi.and_then(|m| m.get(format!("{}.context_length", f).as_str())).and_then(|v| v.as_u64());
                if found.is_some() { break; }
            }
        }
        if found.is_none() {
            if let Some(mi_obj) = mi.and_then(|v| v.as_object()) {
                for (key, val) in mi_obj {
                    if key.ends_with(".context_length") {
                        if let Some(n) = val.as_u64() { found = Some(n); break; }
                    }
                }
            }
        }
        found
    };

    OllamaModelDetails { capabilities, family, families, context_length }
}

async fn fetch_model_details(
    client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model_name: &str,
) -> Result<OllamaModelDetails, AppError> {
    let url = format!("{}/api/show", host);
    let mut req = client.post(&url).json(&serde_json::json!({ "model": model_name }));
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let res = req.send().await.map_err(|e| {
        AppError::Http(format!("/api/show request failed for {}: {}", model_name, e))
    })?;

    if !res.status().is_success() {
        let code = res.status().as_u16();
        let err_body = res.text().await.unwrap_or_default();
        return Err(AppError::Http(format!("Ollama /api/show returned HTTP {} for model {}: {}", code, model_name, &err_body[..err_body.len().min(200)])));
    }

    // Use .text() + from_str instead of .json() for better error diagnostics
    let resp_body = res.text().await.map_err(|e| {
        AppError::Http(format!("/api/show body read failed for {}: {}", model_name, e))
    })?;
    let json: serde_json::Value = serde_json::from_str(&resp_body).map_err(|e| {
        AppError::Http(format!("/api/show JSON parse failed for {}: {}", model_name, e))
    })?;
    Ok(parse_show_response(&json))
}

// ─── Commands ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn save_model_presets(presets: Vec<ModelPreset>, app: AppHandle) -> Result<(), AppError> {
    let path = app_data_dir(&app)?.join("model-presets.json");
    let json = serde_json::to_string_pretty(&presets)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    std::fs::write(&path, json.as_bytes()).map_err(AppError::Io)
}

#[tauri::command]
pub async fn load_model_presets(app: AppHandle) -> Result<Vec<ModelPreset>, AppError> {
    let path = app_data_dir(&app)?.join("model-presets.json");
    if !path.exists() { return Ok(vec![]); }
    let json = std::fs::read_to_string(&path).map_err(AppError::Io)?;
    serde_json::from_str(&json).map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

#[tauri::command]
pub async fn generate_completion(
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
            let request = ChatMessageRequest::new(model.clone(), to_ollama_messages(&messages));
            let response = ollama.send_chat_messages(request).await
                .map_err(|e| AppError::Http(e.to_string()))?;
            Ok(response.message.content)
        }
        "openai" => {
            if api_key.is_empty() { return Err(AppError::Http("OpenAI API key required".into())); }
            let cancel_token = CancellationToken::new();
            chat_completion_openai(client, &api_key, &model, &messages, false, None, &cancel_token).await
        }
        "claude" => {
            if api_key.is_empty() { return Err(AppError::Http("Claude API key required".into())); }
            let cancel_token = CancellationToken::new();
            chat_completion_claude(client, &api_key, &model, &messages, false, None, &cancel_token).await
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    }
}

#[tauri::command]
pub async fn generate_completion_stream(
    request: CompletionRequest,
    on_event: Channel<CompletionEvent>,
    app: AppHandle,
) -> Result<u32, AppError> {
    let state = app.state::<AppState>();
    let client = state.http_client.clone();
    let host = if request.host.is_empty() { "http://localhost:11434".to_string() } else { request.host.trim_end_matches('/').to_string() };
    let mut normalized = request.clone();
    normalized.host = host;

    // Create and register a CancellationToken for this request.
    // The request_id is returned IMMEDIATELY so the frontend can call
    // stop_generation_stream to cancel mid-flight. The actual streaming
    // work is spawned as a detached Tokio task — it sends events through
    // the Channel independently of this function's return value.
    // Per tokio_util docs, CancellationToken supports cooperative
    // cancellation via clone + cancel():
    // https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html
    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let cancel_token = CancellationToken::new();

    let app_data = match app_data_dir(&app) {
        Ok(path) => path,
        Err(e) => {
            // Token not yet registered, safe to return error directly
            return Err(e);
        }
    };

    state.cancellation_tokens.lock().unwrap().insert(request_id, cancel_token.clone());

    // Spawn the streaming work as a detached task. The Channel keeps
    // receiving events regardless of when this function returns.
    // This matches the Tauri Channel pattern shown in the official docs:
    // https://v2.tauri.app/develop/calling-frontend
    // Per Tauri state management docs, AppHandle is Clone and can be
    // moved into spawned tasks to access managed state:
    // https://v2.tauri.app/develop/state-management
    let app_handle = app.clone();
    let result = match normalized.provider.as_str() {
        "ollama" => {
            let cancel_clone = cancel_token.clone();
            tokio::spawn(async move {
                let state = app_handle.state::<AppState>();
                let result = generate_ollama_completion_stream(&normalized, &app_data, &on_event, &cancel_clone, &client).await;
                // Clean up the registered token regardless of outcome
                state.cancellation_tokens.lock().unwrap().remove(&request_id);
                if let Err(e) = result {
                    let _ = on_event.send(CompletionEvent::Error { message: e.to_string() });
                }
            });
            Ok(String::new())
        }
        "openai" => {
            if normalized.api_key.is_empty() { return Err(AppError::Http("OpenAI API key required".into())); }
            let cancel_clone = cancel_token.clone();
            tokio::spawn(async move {
                let state = app_handle.state::<AppState>();
                let result = chat_completion_openai(&client, &normalized.api_key, &normalized.model, &normalized.messages, true, Some(&on_event), &cancel_clone).await;
                state.cancellation_tokens.lock().unwrap().remove(&request_id);
                if let Err(e) = result {
                    let _ = on_event.send(CompletionEvent::Error { message: e.to_string() });
                }
            });
            Ok(String::new())
        }
        "claude" => {
            if normalized.api_key.is_empty() { return Err(AppError::Http("Claude API key required".into())); }
            let cancel_clone = cancel_token.clone();
            tokio::spawn(async move {
                let state = app_handle.state::<AppState>();
                let result = chat_completion_claude(&client, &normalized.api_key, &normalized.model, &normalized.messages, true, Some(&on_event), &cancel_clone).await;
                state.cancellation_tokens.lock().unwrap().remove(&request_id);
                if let Err(e) = result {
                    let _ = on_event.send(CompletionEvent::Error { message: e.to_string() });
                }
            });
            Ok(String::new())
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    };

    if let Err(e) = result {
        state.cancellation_tokens.lock().unwrap().remove(&request_id);
        return Err(e);
    }
    Ok(request_id)
}

/// Cancel a running generation stream by request_id.
/// Signals the CancellationToken which causes the stream loop to break,
/// dropping the HTTP response body and closing the TCP connection.
#[tauri::command]
pub async fn stop_generation_stream(request_id: u32, app: AppHandle) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let tokens = state.cancellation_tokens.lock().unwrap();
    if let Some(token) = tokens.get(&request_id) {
        token.cancel();
        Ok(())
    } else {
        Err(AppError::NotFound(format!("No active generation with request_id {request_id}")))
    }
}

#[tauri::command]
pub async fn list_ollama_models(host: String, api_key: String, app: AppHandle) -> Result<Vec<OllamaModel>, AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let host = if host.is_empty() { "http://localhost:11434".to_string() } else { host.trim_end_matches('/').to_string() };
    let provider = if host == "https://ollama.com" { "ollama-cloud".to_string() } else { "ollama-local".to_string() };

    let ollama = build_ollama_client(&host, &api_key)?;
    let local_models = ollama.list_local_models().await.map_err(|e| AppError::Http(e.to_string()))?;
    let model_names: Vec<String> = local_models.iter().map(|m| m.name.clone()).collect();
    if model_names.is_empty() { return Ok(vec![]); }

    let client_clone = client.clone();
    let host_owned = host.to_string();
    let detail_futures: Vec<_> = model_names.iter().map(|name| {
        let name = name.clone();
        let host = host_owned.clone();
        let api_key = api_key.clone();
        let client = client_clone.clone();
        async move { (name.clone(), fetch_model_details(&client, &host, &api_key, &name).await) }
    }).collect();

    let results = join_all(detail_futures).await;

    Ok(results.into_iter().map(|(name, detail_result)| {
        match detail_result {
            Ok(d) => OllamaModel { id: name.clone(), name, capabilities: d.capabilities, family: d.family, families: d.families, context_length: d.context_length, provider: provider.clone() },
            Err(_) => OllamaModel { id: name.clone(), name, capabilities: vec![], family: String::new(), families: vec![], context_length: None, provider: provider.clone() },
        }
    }).collect())
}
