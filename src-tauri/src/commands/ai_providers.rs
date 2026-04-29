use futures_util::StreamExt;
use tauri::ipc::Channel;
use crate::AppError;
use super::ai::CompletionEvent;

pub async fn chat_completion_openai(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[super::ai::Message],
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
        if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done); }
        Ok(full)
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        Ok(json["choices"][0]["message"]["content"].as_str().unwrap_or("").to_string())
    }
}

pub async fn chat_completion_claude(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    messages: &[super::ai::Message],
    stream: bool,
    on_event: Option<&Channel<CompletionEvent>>,
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
        if let Some(ev) = on_event { let _ = ev.send(CompletionEvent::Done); }
        Ok(full)
    } else {
        let json: serde_json::Value = res.json().await.map_err(|e| AppError::Http(e.to_string()))?;
        Ok(json["content"][0]["text"].as_str().unwrap_or("").to_string())
    }
}
