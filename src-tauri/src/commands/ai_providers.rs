use futures_util::StreamExt;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;
use crate::AppError;
use super::ai::{CompletionEvent, TokenUsage};

/// Chat completion via OpenAI-compatible API (also used for compatible endpoints).
/// When `stream` is true and `on_event` is provided, SSE chunks are forwarded
/// through the channel. `cancel_token` enables cooperative cancellation
/// per tokio_util::sync::CancellationToken semantics:
/// https://docs.rs/tokio-util/latest/tokio_util/sync/struct.CancellationToken.html
pub async fn chat_completion_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[super::ai::Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
    cancel_token: &CancellationToken,
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
        loop {
            tokio::select! {
                chunk_result = byte_stream.next() => {
                    match chunk_result {
                        Some(Ok(chunk)) => {
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
                        Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                        None => {
                            if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done { done_reason: None, usage: None }); }
                            return Ok(full);
                        }
                    }
                }
                _ = cancel_token.cancelled() => {
                    // Cancellation requested — drop the byte stream to close
                    // the HTTP connection, stopping server-side generation.
                    drop(byte_stream);
                    if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done { done_reason: None, usage: None }); }
                    return Ok(full);
                }
            }
        }
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        Ok(json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
    }
}

/// Chat completion via Anthropic Claude API.
/// Same cancellation pattern as OpenAI — `tokio::select!` races the byte
/// stream against CancellationToken::cancelled().
pub async fn chat_completion_claude(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[super::ai::Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
    cancel_token: &CancellationToken,
) -> Result<String, AppError> {
    let url = "https://api.anthropic.com/v1/messages";
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
    let body = serde_json::json!({
        "model": model, "messages": msgs, "stream": stream, "max_tokens": 4096,
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
        let mut usage = TokenUsage::default();
        let mut byte_stream = res.bytes_stream();
        loop {
            tokio::select! {
                chunk_result = byte_stream.next() => {
                    match chunk_result {
                        Some(Ok(chunk)) => {
                            for line in String::from_utf8_lossy(&chunk).lines() {
                                if !line.starts_with("data: ") { continue; }
                                let data = &line[6..];
                                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                                    match json["type"].as_str().unwrap_or("") {
                                        // https://docs.anthropic.com/en/api/messages-streaming#message-start
                                        "message_start" => {
                                            if let Some(n) = json["message"]["usage"]["input_tokens"].as_u64() {
                                                usage.prompt_tokens = n;
                                            }
                                            if let Some(n) = json["message"]["usage"]["output_tokens"].as_u64() {
                                                usage.completion_tokens = n;
                                            }
                                        }
                                        // https://docs.anthropic.com/en/api/messages-streaming#message-delta
                                        "message_delta" => {
                                            if let Some(n) = json["usage"]["output_tokens"].as_u64() {
                                                usage.completion_tokens = n;
                                            }
                                        }
                                        _ => {}
                                    }
                                    if let Some(text) = json["delta"]["text"].as_str() {
                                        full.push_str(text);
                                        if let Some(ev) = on_event {
                                            let _ = ev.send(CompletionEvent::Chunk { text: text.to_string(), thinking: None });
                                        }
                                    }
                                }
                            }
                        }
                        Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                        None => {
                            if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done { done_reason: None, usage: Some(usage) }); }
                            return Ok(full);
                        }
                    }
                }
                _ = cancel_token.cancelled() => {
                    drop(byte_stream);
                    if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done { done_reason: None, usage: Some(usage) }); }
                    return Ok(full);
                }
            }
        }
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        Ok(json["content"][0]["text"].as_str().unwrap_or("").to_string())
    }
}