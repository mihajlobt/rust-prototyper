use futures_util::StreamExt;
use json_lines::codec::JsonLinesCodec;
use bytes::BytesMut;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::{AppHandle, Manager};
use tauri::ipc::Channel;
use tokio_util::codec::Decoder;
use ollama_rs::{
    generation::{
        chat::{ChatMessage as OllamaChatMessage, request::ChatMessageRequest},
        images::Image,
        parameters::ThinkType,
    },
};
use tokio_util::sync::CancellationToken;
use crate::{AppState, AppError, app_data_dir};
use super::ai_providers::{chat_completion_openai, chat_completion_claude};
use super::ai_ollama::{OllamaOptions, build_ollama_client};

// ─── Types ────────────────────────────────────────────────────────────────────

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
    ToolPermission { request_id: u64, tool: String, args: serde_json::Value },
    ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
    AskUser { request_id: u64, question: String, question_type: AskUserQuestionType, choices: Option<Vec<String>> },
    AskUserForm { request_id: u64, title: String, fields: Vec<FormField> },
    Done { done_reason: Option<String> },
    Error { message: String },
}

/// User's decision for a tool permission request.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionDecision {
    Accepted,
    Rejected,
    AlwaysAllowed,
}

/// Global permission mode controlling when the user is prompted.
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum ToolPermissionMode {
    #[default]
    AskEveryTime,
    /// Allow read_file silently; gate write_file/bash.
    AutoAcceptReadOnly,
    /// Execute everything without prompting (for testing).
    AutoAcceptAll,
}

/// Question type for ask_user tool calls.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AskUserQuestionType {
    Text,
    Choice,
    Confirm,
}

/// Field type for ask_user_form tool calls.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FormFieldType {
    Text,
    Choice,
    Multiselect,
    Confirm,
}

/// A single field definition within an ask_user_form call.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct FormField {
    pub id: String,
    pub label: String,
    pub field_type: FormFieldType,
    pub choices: Option<Vec<String>>,
    pub placeholder: Option<String>,
    pub required: Option<bool>,
}

// ─── Request / response types ─────────────────────────────────────────────────

// OllamaOptions, ModelPreset, OllamaModel, OllamaModelDetails are defined in ai_ollama.rs

#[derive(serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompletionRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub host: String,
    pub api_key: String,
    pub provider: String,
    /// Accepts `true`, `false`, `"low"`, `"medium"`, or `"high"`.
    /// GPT-OSS requires string levels; other models use boolean.
    pub think: Option<serde_json::Value>,
    pub output_path: Option<String>,
    pub options: Option<OllamaOptions>,
    /// Permission mode for agent tool calls.
    #[serde(default)]
    pub tool_permission_mode: ToolPermissionMode,
    /// Tool names that are always allowed (user-approved allowlist).
    #[serde(default)]
    pub tool_allowlist: Vec<String>,
    /// Model family as returned by Ollama's /api/show (e.g. "gemma4", "gptoss").
    /// Used for model-specific behaviour like Gemma4's <|think|> system prompt prefix.
    #[serde(default)]
    pub model_family: Option<String>,
    /// Maximum number of tool-call iterations the agent loop will run.
    /// Defaults to MAX_ITERATIONS in agent_loop.rs when absent or zero.
    #[serde(default)]
    pub max_tool_calls: Option<u8>,
    /// If non-empty, only tools whose names are in this list are offered to the model.
    /// Empty = all tools available (default behavior).
    #[serde(default)]
    pub tool_filter: Vec<String>,
}

/// Convert a JSON value from the frontend think parameter to a ThinkType
/// for the ollama-rs agent loop. Supports:
///   - `true`  → ThinkType::True   (most models)
///   - `false` → ThinkType::False   (most models)
///   - `"low"` → ThinkType::Low     (GPT-OSS)
///   - `"medium"` → ThinkType::Medium (GPT-OSS)
///   - `"high"` → ThinkType::High    (GPT-OSS)
fn think_type_from_value(v: &serde_json::Value) -> Option<ThinkType> {
    match v {
        serde_json::Value::Bool(b) => Some(ThinkType::from(*b)),
        serde_json::Value::String(s) => match s.as_str() {
            "low" => Some(ThinkType::Low),
            "medium" => Some(ThinkType::Medium),
            "high" => Some(ThinkType::High),
            _ => None,
        },
        _ => None,
    }
}

// ─── Ollama message conversion ─────────────────────────────────────────────────

/// Convert frontend messages to ollama-rs ChatMessage for the non-streaming path.
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

// ─── Message serialization ────────────────────────────────────────────────────

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

        // Ollama multi-turn tool-calling: include thinking in history.
        // https://docs.ollama.com/capabilities/tool-calling
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

async fn generate_ollama_completion_stream(
    request: &CompletionRequest,
    app_data_dir: &std::path::Path,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    http_client: &reqwest::Client,
    app_handle: &AppHandle,
) -> Result<(), AppError> {
    if let Some(path) = request.output_path.as_deref() {
        let json_messages = messages_to_ollama_json(&request.messages);
        let allowlist: std::collections::HashSet<String> = request.tool_allowlist.iter().cloned().collect();
        let tool_filter: std::collections::HashSet<String> = request.tool_filter.iter().cloned().collect();
        crate::agent::run_agent_loop(crate::agent::AgentLoopParams {
            provider: &request.provider,
            http_client,
            host: &request.host,
            api_key: &request.api_key,
            model: &request.model,
            model_family: request.model_family.as_deref().unwrap_or(""),
            initial_messages_json: json_messages,
            think: request.think.as_ref().and_then(think_type_from_value),
            app_data_dir,
            output_path: path,
            channel,
            cancel_token,
            app_handle,
            permission_mode: request.tool_permission_mode,
            tool_allowlist: allowlist,
            max_tool_calls: request.max_tool_calls,
            tool_filter,
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

        if let Some(think_val) = &request.think {
            body["think"] = think_val.clone();
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
            let code = res.status().as_u16();
            let err_body = res.text().await
                .unwrap_or_else(|_| format!("<failed to read body, HTTP {code}>"));
            return Err(AppError::Http(format!("HTTP {code}: {}", &err_body[..err_body.len().min(400)])));
        }

        let mut byte_stream = res.bytes_stream();
        let mut codec = JsonLinesCodec::<OllamaStreamChunk, OllamaStreamChunk>::default();
        let mut buffer = BytesMut::new();

        loop {
            tokio::select! {
                chunk_result = byte_stream.next() => {
                    match chunk_result {
                        Some(Ok(chunk)) => {
                            buffer.extend_from_slice(&chunk);
                            loop {
                                match codec.decode(&mut buffer) {
                                    Ok(Some(response)) => {
                                        let thinking = response.message.thinking.filter(|t| !t.is_empty());
                                        let text = response.message.content.clone();
                                        if thinking.is_some() || !text.is_empty() {
                                            let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                                        }
                                        if response.done {
                                            let _ = channel.send(CompletionEvent::Done { done_reason: response.done_reason });
                                            return Ok(());
                                        }
                                    }
                                    Ok(None) => break,
                                    Err(e) => return Err(AppError::Http(format!(
                                        "stream parse error: {} (buffer has {} bytes)",
                                        e, buffer.len()
                                    ))),
                                }
                            }
                        }
                        Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                        None => {
                            let _ = channel.send(CompletionEvent::Done { done_reason: None });
                            return Ok(());
                        }
                    }
                }
                _ = cancel_token.cancelled() => {
                    // Push partial content before dropping the stream so
                    // the next turn has context if user cancels mid-generation.
                    drop(byte_stream);
                    let _ = channel.send(CompletionEvent::Done { done_reason: None });
                    return Ok(());
                }
            }
        }
    }
}

/// Minimal struct for deserializing the Ollama /api/chat streaming response.
/// Only the fields we need — content, thinking, done.
#[derive(serde::Deserialize)]
struct OllamaStreamChunk {
    message: OllamaStreamMessage,
    done: bool,
    #[serde(default)]
    done_reason: Option<String>,
}

#[derive(serde::Deserialize)]
struct OllamaStreamMessage {
    #[serde(default)]
    content: String,
    #[serde(default)]
    thinking: Option<String>,
}

// ─── Claude streaming ─────────────────────────────────────────────────────────

async fn generate_claude_completion_stream(
    request: &CompletionRequest,
    app_data_dir: &std::path::Path,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    http_client: &reqwest::Client,
    app_handle: &AppHandle,
) -> Result<(), AppError> {
    if let Some(path) = request.output_path.as_deref() {
        let json_messages = messages_to_ollama_json(&request.messages);
        let allowlist: std::collections::HashSet<String> = request.tool_allowlist.iter().cloned().collect();
        let tool_filter: std::collections::HashSet<String> = request.tool_filter.iter().cloned().collect();
        crate::agent::run_agent_loop(crate::agent::AgentLoopParams {
            provider: "claude",
            http_client,
            host: &request.host,
            api_key: &request.api_key,
            model: &request.model,
            model_family: "",
            initial_messages_json: json_messages,
            think: request.think.as_ref().and_then(think_type_from_value),
            app_data_dir,
            output_path: path,
            channel,
            cancel_token,
            app_handle,
            permission_mode: request.tool_permission_mode,
            tool_allowlist: allowlist,
            max_tool_calls: request.max_tool_calls,
            tool_filter,
        }).await
    } else {
        chat_completion_claude(http_client, &request.api_key, &request.model, &request.messages, true, Some(channel), cancel_token).await.map(|_| ())
    }
}

// ─── Commands ─────────────────────────────────────────────────────────────────

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

    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let cancel_token = CancellationToken::new();

    let app_data = match app_data_dir(&app) {
        Ok(path) => path,
        Err(e) => {
            return Err(e);
        }
    };

    state.cancellation_tokens.lock().unwrap().insert(request_id, cancel_token.clone());

    let app_handle = app.clone();
    let result = match normalized.provider.as_str() {
        "ollama" => {
            let cancel_clone = cancel_token.clone();
            tokio::spawn(async move {
                let state = app_handle.state::<AppState>();
                let result = generate_ollama_completion_stream(&normalized, &app_data, &on_event, &cancel_clone, &client, &app_handle).await;
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
                let result = generate_claude_completion_stream(&normalized, &app_data, &on_event, &cancel_clone, &client, &app_handle).await;
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

/// Fetch available Claude models from the Anthropic /v1/models API.
#[tauri::command]
pub async fn list_anthropic_models(api_key: String, app: AppHandle) -> Result<Vec<serde_json::Value>, AppError> {
    let state = app.state::<AppState>();
    let res = state.http_client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        let msg = serde_json::from_str::<serde_json::Value>(&err)
            .ok()
            .and_then(|v| v["error"]["message"].as_str().map(String::from))
            .unwrap_or(err);
        return Err(AppError::Http(msg));
    }
    let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
    let models = json["data"].as_array().cloned().unwrap_or_default();
    Ok(models)
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

/// Pending tool permission request awaiting user decision.
pub struct PendingToolPermission {
    pub sender: tokio::sync::oneshot::Sender<ToolPermissionDecision>,
    pub tool: String,
    pub args: serde_json::Value,
}

/// Resolve a pending tool permission request.
/// Called by frontend when user clicks Accept/Reject/Always Allow.
#[tauri::command]
pub fn resolve_tool_permission(
    permission_id: u64,
    decision: ToolPermissionDecision,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<crate::AppState>();
    let mut permissions = state.pending_permissions.lock().unwrap();
    let pending = permissions
        .remove(&permission_id)
        .ok_or_else(|| AppError::NotFound(format!("Permission request {permission_id} not found or already resolved")))?;
    drop(permissions);
    let _ = pending.sender.send(decision);
    Ok(())
}

/// Resolve a pending ask_user request.
/// Called by frontend when user submits their answer to the AI's question.
#[tauri::command]
pub fn resolve_ask_user(
    request_id: u64,
    answer: String,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<crate::AppState>();
    let mut pending = state.pending_ask_user.lock().unwrap();
    let sender = pending
        .remove(&request_id)
        .ok_or_else(|| AppError::NotFound(format!("Ask-user request {request_id} not found or already resolved")))?;
    drop(pending);
    let _ = sender.send(answer);
    Ok(())
}

/// Resolve a pending ask_user_form request.
/// answers is a JSON object mapping field IDs to string or string[] values.
#[tauri::command]
pub fn resolve_ask_user_form(
    request_id: u64,
    answers: serde_json::Value,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<crate::AppState>();
    let mut pending = state.pending_ask_user_form.lock().unwrap();
    let sender = pending
        .remove(&request_id)
        .ok_or_else(|| AppError::NotFound(format!("Form request {request_id} not found or already resolved")))?;
    drop(pending);
    let answers_string = serde_json::to_string(&answers).unwrap_or_else(|_| "{}".to_string());
    let _ = sender.send(answers_string);
    Ok(())
}

// save_model_presets, load_model_presets, list_ollama_models are in ai_ollama.rs