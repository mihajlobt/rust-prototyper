use futures_util::StreamExt;
use futures_util::future::join_all;
use tauri::{AppHandle, Manager};
use tauri::ipc::Channel;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{ChatMessage as OllamaChatMessage, request::ChatMessageRequest},
        images::Image,
        parameters::ThinkType,
    },
    models::ModelOptions,
};
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

pub(crate) fn to_ollama_messages(messages: &[Message]) -> Vec<OllamaChatMessage> {
    messages.iter().map(|m| {
        let mut msg = match m.role.as_str() {
            "assistant" => OllamaChatMessage::assistant(m.content.clone()),
            "system" => OllamaChatMessage::system(m.content.clone()),
            _ => OllamaChatMessage::user(m.content.clone()),
        };
        // thinking must be included for assistant history so the model continues reasoning
        msg.thinking = m.thinking.clone();
        if !m.images.is_empty() {
            msg = msg.with_images(m.images.iter().map(|b| Image::from_base64(b.clone())).collect());
        }
        msg
    }).collect()
}

// ─── Ollama streaming ─────────────────────────────────────────────────────────

async fn generate_ollama_completion_stream(
    request: &CompletionRequest,
    app_data_dir: &std::path::Path,
    channel: &Channel<CompletionEvent>,
) -> Result<(), AppError> {
    let ollama = build_ollama_client(&request.host, &request.api_key)?;
    let ollama_messages = to_ollama_messages(&request.messages);

    if let Some(path) = request.output_path.as_deref() {
        crate::agent::run_agent_loop(
            &ollama, &request.model, ollama_messages, request.think, app_data_dir, path, channel,
        ).await
    } else {
        let mut chat_request = ChatMessageRequest::new(request.model.clone(), ollama_messages);
        if let Some(true) = request.think {
            chat_request = chat_request.think(ThinkType::True);
        }
        if let Some(opts) = &request.options {
            let mut model_opts = ModelOptions::default();
            if let Some(v) = opts.temperature    { model_opts = model_opts.temperature(v); }
            if let Some(v) = opts.top_k          { model_opts = model_opts.top_k(v); }
            if let Some(v) = opts.top_p          { model_opts = model_opts.top_p(v); }
            if let Some(v) = opts.num_ctx        { model_opts = model_opts.num_ctx(v); }
            if let Some(v) = opts.num_predict    { model_opts = model_opts.num_predict(v); }
            if let Some(v) = opts.repeat_penalty { model_opts = model_opts.repeat_penalty(v); }
            if let Some(v) = opts.repeat_last_n  { model_opts = model_opts.repeat_last_n(v); }
            if let Some(v) = opts.seed           { model_opts = model_opts.seed(v); }
            if let Some(v) = opts.mirostat       { model_opts = model_opts.mirostat(v); }
            if let Some(v) = opts.mirostat_tau   { model_opts = model_opts.mirostat_tau(v); }
            if let Some(v) = opts.mirostat_eta   { model_opts = model_opts.mirostat_eta(v); }
            if let Some(v) = opts.tfs_z          { model_opts = model_opts.tfs_z(v); }
            chat_request = chat_request.options(model_opts);
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
                Err(_) => return Err(AppError::Http("Ollama stream error".into())),
            }
        }
        let _ = channel.send(CompletionEvent::Done);
        Ok(())
    }
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
            found = mi.and_then(|m| m.get(&format!("{}.context_length", family))).and_then(|v| v.as_u64());
        }
        if found.is_none() {
            for f in &families {
                if f == &family { continue; }
                found = mi.and_then(|m| m.get(&format!("{}.context_length", f))).and_then(|v| v.as_u64());
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
            chat_completion_openai(client, &api_key, &model, &messages, false, None).await
        }
        "claude" => {
            if api_key.is_empty() { return Err(AppError::Http("Claude API key required".into())); }
            chat_completion_claude(client, &api_key, &model, &messages, false, None).await
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    }
}

#[tauri::command]
pub async fn generate_completion_stream(
    request: CompletionRequest,
    on_event: Channel<CompletionEvent>,
    app: AppHandle,
) -> Result<(), AppError> {
    let state = app.state::<AppState>();
    let client = &state.http_client;
    let host = if request.host.is_empty() { "http://localhost:11434".to_string() } else { request.host.trim_end_matches('/').to_string() };
    let mut normalized = request.clone();
    normalized.host = host;

    let app_data = app_data_dir(&app)?;
    let result = match normalized.provider.as_str() {
        "ollama" => {
            generate_ollama_completion_stream(&normalized, &app_data, &on_event).await.map(|_| String::new())
        }
        "openai" => {
            if normalized.api_key.is_empty() { return Err(AppError::Http("OpenAI API key required".into())); }
            chat_completion_openai(client, &normalized.api_key, &normalized.model, &normalized.messages, true, Some(&on_event)).await
        }
        "claude" => {
            if normalized.api_key.is_empty() { return Err(AppError::Http("Claude API key required".into())); }
            chat_completion_claude(client, &normalized.api_key, &normalized.model, &normalized.messages, true, Some(&on_event)).await
        }
        _ => Err(AppError::Http("Unsupported provider".into())),
    };

    if let Err(e) = result {
        let _ = on_event.send(CompletionEvent::Error { message: e.to_string() });
        return Err(e);
    }
    Ok(())
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
