use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use bytes::BytesMut;
use futures_util::StreamExt;
use futures::future::join_all;
use json_lines::codec::JsonLinesCodec;
use ollama_rs::generation::parameters::ThinkType;
use tauri::{ipc::Channel, Manager};
use tokio_util::codec::Decoder;
use tokio_util::sync::CancellationToken;
use crate::commands::ai::{ToolPermissionDecision, ToolPermissionMode, AskUserQuestionType};
use crate::{AppError, CompletionEvent};
use super::{executor::{execute_tool, ToolExecutionResult}, tools::build_tools};

pub(super) const MAX_ITERATIONS: u8 = 20;
pub(super) const MAX_WRITES: u8 = 10;
pub(super) const MAX_TOOL_OUTPUT_FOR_HISTORY: usize = 15000;

pub(super) fn project_dir(app_data_dir: &Path, output_path: &str) -> PathBuf {
    let parts: Vec<&str> = output_path.splitn(3, '/').collect();
    if parts.len() >= 2 {
        app_data_dir.join(parts[0]).join(parts[1])
    } else {
        app_data_dir.to_path_buf()
    }
}

pub(super) async fn setup_project_dir(proj_dir: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let generated = proj_dir.join("generated");
        if tokio::fs::try_exists(&generated).await.unwrap_or(false) {
            // Symlink project_dir/node_modules → generated/node_modules so that
            // tools running from the project root can resolve packages.
            let link = proj_dir.join("node_modules");
            if !tokio::fs::try_exists(&link).await.unwrap_or(false) {
                let _ = symlink("generated/node_modules", &link);
            }
        }
    }
}

fn assistant_msg_with_thinking(content: &str, thinking: Option<&str>, tool_calls: &[serde_json::Value]) -> serde_json::Value {
    let mut msg = serde_json::json!({"role": "assistant", "content": content});
    // Ollama multi-turn tool-calling: include thinking in history.
    // https://docs.ollama.com/capabilities/tool-calling
    if let Some(t) = thinking {
        msg["thinking"] = serde_json::Value::String(t.to_string());
    }
    if !tool_calls.is_empty() {
        msg["tool_calls"] = serde_json::Value::Array(tool_calls.to_vec());
    }
    msg
}

fn tool_result_msg(tool_name: &str, content: &str) -> serde_json::Value {
    serde_json::json!({
        "role": "tool",
        "tool_name": tool_name,
        "content": content,
    })
}

fn parse_tool_call(value: &serde_json::Value) -> Option<(String, serde_json::Value)> {
    let func = value.get("function")?;
    let name = func.get("name")?.as_str()?.to_string();
    let arguments = func.get("arguments").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    Some((name, arguments))
}

#[derive(serde::Deserialize)]
struct StreamChunk {
    message: StreamMessage,
    done: bool,
}

#[derive(serde::Deserialize)]
struct StreamMessage {
    content: String,
    #[serde(default)]
    thinking: Option<String>,
    #[serde(default)]
    tool_calls: Vec<serde_json::Value>,
}

#[allow(clippy::too_many_arguments)]
async fn stream_turn(
    http_client: &reqwest::Client,
    host: &str,
    api_key: &str,
    model: &str,
    history: &mut Vec<serde_json::Value>,
    think: Option<&ThinkType>,
    tools_json: &serde_json::Value,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
) -> Result<Vec<(String, serde_json::Value)>, AppError> {
    let mut body = serde_json::json!({
        "model": model,
        "messages": history,
        "stream": true,
        "tools": tools_json,
    });

    if let Some(tt) = think {
        body["think"] = serde_json::to_value(tt)
            .expect("ThinkType always serializes; never fails");
    }

    let url = format!("{}/api/chat", host);
    let mut req_builder = http_client.post(&url).json(&body);
    if !api_key.is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let res = req_builder.send().await.map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let code = res.status().as_u16();
        let err_body = res.text().await
            .unwrap_or_else(|_| format!("<failed to read body, HTTP {code}>"));
        return Err(AppError::Http(format!("HTTP {code}: {}", &err_body[..err_body.len().min(400)])));
    }

    let mut byte_stream = res.bytes_stream();
    let mut codec = JsonLinesCodec::<StreamChunk, StreamChunk>::default();
    let mut tool_calls: Vec<(String, serde_json::Value)> = vec![];
    let mut content_accumulated = String::new();
    let mut thinking_accumulated: Option<String> = None;
    let mut tool_calls_json: Vec<serde_json::Value> = vec![];
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
                                    if !response.message.tool_calls.is_empty() {
                                        tool_calls_json = response.message.tool_calls.clone();
                                        tool_calls = response.message.tool_calls.iter()
                                            .filter_map(parse_tool_call)
                                            .collect();
                                    }
                                    let thinking = response.message.thinking.filter(|t| !t.is_empty());
                                    let text = response.message.content.clone();
                                    if !text.is_empty() {
                                        content_accumulated.push_str(&text);
                                    }
                                    if let Some(t) = &thinking {
                                        thinking_accumulated = Some(match thinking_accumulated {
                                            Some(existing) => existing + t,
                                            None => t.clone(),
                                        });
                                    }
                                    if thinking.is_some() || !text.is_empty() {
                                        let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                                    }
                                    if response.done {
                                        let assistant = assistant_msg_with_thinking(
                                            &content_accumulated,
                                            thinking_accumulated.as_deref(),
                                            &tool_calls_json,
                                        );
                                        history.push(assistant);
                                        return Ok(tool_calls);
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
                        let assistant = assistant_msg_with_thinking(
                            &content_accumulated,
                            thinking_accumulated.as_deref(),
                            &tool_calls_json,
                        );
                        history.push(assistant);
                        return Ok(tool_calls);
                    }
                }
            }
            _ = cancel_token.cancelled() => {
                let assistant = assistant_msg_with_thinking(
                    &content_accumulated,
                    thinking_accumulated.as_deref(),
                    &tool_calls_json,
                );
                history.push(assistant);
                drop(byte_stream);
                return Ok(tool_calls);
            }
        }
    }
}

// ─── Permission system ───────────────────────────────────────────────────────

/// Check if a tool should be gated or auto-allowed.
/// Returns (should_gate, always_allow_this_tool).
pub(super) fn check_permission_gate(
    tool: &str,
    mode: ToolPermissionMode,
    allowlist: &HashSet<String>,
) -> bool {
    match mode {
        ToolPermissionMode::AutoAcceptAll => false,
        ToolPermissionMode::AutoAcceptReadOnly => {
            if tool == "read_file" { false }
            else { !allowlist.contains(tool) }
        }
        ToolPermissionMode::AskEveryTime => !allowlist.contains(tool),
    }
}

/// Request permission from the user and block until resolved.
pub(super) async fn request_permission(
    tool: &str,
    args: &serde_json::Value,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    app_handle: &tauri::AppHandle,
) -> ToolPermissionDecision {
    let state = app_handle.state::<crate::AppState>();
    let request_id = state.next_permission_id.fetch_add(1, Ordering::SeqCst);

    let (tx, rx) = tokio::sync::oneshot::channel::<ToolPermissionDecision>();

    {
        let mut permissions = state.pending_permissions.lock().unwrap();
        permissions.insert(request_id, crate::commands::ai::PendingToolPermission {
            sender: tx,
            tool: tool.to_string(),
            args: args.clone(),
        });
    }

    let _ = channel.send(CompletionEvent::ToolPermission {
        request_id,
        tool: tool.to_string(),
        args: args.clone(),
    });

    let decision = tokio::select! {
        decision_result = rx => {
            let mut permissions = state.pending_permissions.lock().unwrap();
            permissions.remove(&request_id);
            decision_result.unwrap_or(ToolPermissionDecision::Rejected)
        }
        _ = cancel_token.cancelled() => {
            let mut permissions = state.pending_permissions.lock().unwrap();
            if let Some(pending) = permissions.remove(&request_id) {
                let _ = pending.sender.send(ToolPermissionDecision::Rejected);
            }
            ToolPermissionDecision::Rejected
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(300)) => {
            let mut permissions = state.pending_permissions.lock().unwrap();
            if let Some(pending) = permissions.remove(&request_id) {
                let _ = pending.sender.send(ToolPermissionDecision::Rejected);
            }
            ToolPermissionDecision::Rejected
        }
    };

    decision
}

pub(super) async fn request_ask_user(
    args: &serde_json::Value,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    app_handle: &tauri::AppHandle,
) -> String {
    let state = app_handle.state::<crate::AppState>();
    let request_id = state.next_permission_id.fetch_add(1, Ordering::SeqCst);

    let question = args.get("question")
        .and_then(|v| v.as_str())
        .unwrap_or("What would you like?")
        .to_string();

    let question_type = match args.get("question_type").and_then(|v| v.as_str()) {
        Some("choice") => AskUserQuestionType::Choice,
        Some("confirm") => AskUserQuestionType::Confirm,
        _ => AskUserQuestionType::Text,
    };

    // Tolerant choice extractor: accept plain strings, or objects with
    // `description`/`label`/`text` fields, or nested linked-list forms like
    // `{ "description": "…", "item": { "description": "…", "item": … } }`
    // that some models emit. Always flatten to a Vec<String>.
    let choices = args.get("choices").and_then(|v| v.as_array()).map(|arr| {
        fn flatten_choice(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::String(s) => out.push(s.clone()),
                serde_json::Value::Object(map) => {
                    // Prefer the most descriptive text field available
                    let text = map
                        .get("description")
                        .or_else(|| map.get("label"))
                        .or_else(|| map.get("text"))
                        .or_else(|| map.get("value"))
                        .and_then(|v| v.as_str())
                        .map(str::to_string);
                    if let Some(t) = text {
                        out.push(t);
                    }
                    // Recurse into the linked-list `item` field if present
                    if let Some(next) = map.get("item") {
                        flatten_choice(next, out);
                    }
                }
                _ => {}
            }
        }
        let mut out = Vec::new();
        for v in arr {
            flatten_choice(v, &mut out);
        }
        out
    });

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();

    {
        let mut pending = state.pending_ask_user.lock().unwrap();
        pending.insert(request_id, tx);
    }

    let _ = channel.send(CompletionEvent::AskUser {
        request_id,
        question,
        question_type,
        choices,
    });

    tokio::select! {
        result = rx => {
            state.pending_ask_user.lock().unwrap().remove(&request_id);
            result.unwrap_or_else(|_| "No response provided".to_string())
        }
        _ = cancel_token.cancelled() => {
            state.pending_ask_user.lock().unwrap().remove(&request_id);
            "Cancelled (ask_user cancelled)".to_string()
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(180)) => {
            state.pending_ask_user.lock().unwrap().remove(&request_id);
            "No response (ask_user timed out after 3 minutes)".to_string()
        }
    }
}

pub(super) async fn request_ask_user_form(
    args: &serde_json::Value,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    app_handle: &tauri::AppHandle,
) -> String {
    use crate::commands::ai::{FormField, FormFieldType};

    let state = app_handle.state::<crate::AppState>();
    let request_id = state.next_permission_id.fetch_add(1, Ordering::SeqCst);

    let title = args.get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Please answer these questions")
        .to_string();

    let fields: Vec<FormField> = args.get("fields")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter().filter_map(|f| {
                let obj = f.as_object()?;
                let id = obj.get("id")?.as_str()?.to_string();
                let label = obj.get("label")?.as_str()?.to_string();
                let field_type = match obj.get("field_type").and_then(|v| v.as_str()) {
                    Some("choice") => FormFieldType::Choice,
                    Some("multiselect") => FormFieldType::Multiselect,
                    Some("confirm") => FormFieldType::Confirm,
                    _ => FormFieldType::Text,
                };
                let choices = obj.get("choices").and_then(|v| v.as_array()).map(|arr| {
                    arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()
                });
                let placeholder = obj.get("placeholder").and_then(|v| v.as_str()).map(str::to_string);
                let required = obj.get("required").and_then(|v| v.as_bool());
                Some(FormField { id, label, field_type, choices, placeholder, required })
            }).collect()
        })
        .unwrap_or_default();

    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    {
        let mut pending = state.pending_ask_user_form.lock().unwrap();
        pending.insert(request_id, tx);
    }

    let _ = channel.send(CompletionEvent::AskUserForm { request_id, title, fields });

    tokio::select! {
        result = rx => {
            state.pending_ask_user_form.lock().unwrap().remove(&request_id);
            result.unwrap_or_else(|_| "{}".to_string())
        }
        _ = cancel_token.cancelled() => {
            state.pending_ask_user_form.lock().unwrap().remove(&request_id);
            "{}".to_string()
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(180)) => {
            state.pending_ask_user_form.lock().unwrap().remove(&request_id);
            "{}".to_string()
        }
    }
}

pub struct AgentLoopParams<'a> {
    pub provider: &'a str,
    pub http_client: &'a reqwest::Client,
    pub host: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
    /// Model family as returned by Ollama's /api/show details.family (e.g. "gemma4", "gptoss").
    pub model_family: &'a str,
    pub initial_messages_json: Vec<serde_json::Value>,
    pub think: Option<ThinkType>,
    pub app_data_dir: &'a Path,
    pub output_path: &'a str,
    pub channel: &'a Channel<CompletionEvent>,
    pub cancel_token: &'a CancellationToken,
    pub app_handle: &'a tauri::AppHandle,
    pub permission_mode: ToolPermissionMode,
    pub tool_allowlist: HashSet<String>,
    /// Override for MAX_ITERATIONS. None or 0 falls back to the compiled default.
    pub max_tool_calls: Option<u8>,
    /// If non-empty, only tools whose names are in this set are offered to the model.
    /// Empty = all tools available (default).
    pub tool_filter: HashSet<String>,
    /// SearXNG base URL for the web_search tool (e.g. "http://localhost:8080"). Empty = disabled.
    pub searxng_url: String,
    /// Override for MAX_WRITES. None falls back to compiled default.
    pub write_file_limit: Option<u8>,
    /// Override for MAX_TOOL_OUTPUT_FOR_HISTORY. None falls back to compiled default.
    pub tool_output_history_limit: Option<usize>,
}

pub async fn run_agent_loop(params: AgentLoopParams<'_>) -> Result<(), AppError> {
    if params.provider == "claude" {
        return super::claude::run_agent_loop_claude(params).await;
    }
    let AgentLoopParams { provider: _, http_client, host, api_key, model, model_family, initial_messages_json, think, app_data_dir, output_path, channel, cancel_token, app_handle, permission_mode, tool_allowlist, max_tool_calls, tool_filter, searxng_url, write_file_limit, tool_output_history_limit } = params;
    let max_iterations = max_tool_calls.filter(|&n| n > 0).unwrap_or(MAX_ITERATIONS);
    let write_file_limit = write_file_limit.filter(|&n| n > 0).unwrap_or(MAX_WRITES);
    let tool_output_history_limit = tool_output_history_limit.unwrap_or(MAX_TOOL_OUTPUT_FOR_HISTORY);
    let proj_dir = project_dir(app_data_dir, output_path);
    let _ = tokio::fs::create_dir_all(&proj_dir).await;
    setup_project_dir(&proj_dir).await;

    // Gemma4 requires <|think|> at the start of the system prompt to enable thinking.
    // The think: true API parameter alone is insufficient for this model family.
    // https://ai.google.dev/gemma/docs/capabilities/thinking
    let mut history = initial_messages_json;
    if model_family == "gemma4" && think.is_some() {
        if let Some(system) = history.iter_mut().find(|m| m["role"] == "system") {
            let content = system["content"].as_str().unwrap_or("");
            if !content.starts_with("<|think|>") {
                system["content"] = format!("<|think|>{content}").into();
            }
        }
    }
    let all_tools = build_tools();
    let tools: Vec<_> = if tool_filter.is_empty() {
        all_tools
    } else {
        all_tools.into_iter().filter(|t| tool_filter.contains(&t.function.name)).collect()
    };
    let tools_json = serde_json::to_value(&tools).expect("tools serialization should never fail");

    let mut iteration: u8 = 0;
    let write_count = Arc::new(AtomicU8::new(0));

    loop {
        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done { done_reason: None });
            return Ok(());
        }

        let tool_calls = stream_turn(
            http_client, host, api_key, model,
            &mut history, think.as_ref(), &tools_json,
            channel, cancel_token,
        ).await?;

        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done { done_reason: None });
            return Ok(());
        }

        if tool_calls.is_empty() {
            break;
        }

        if iteration >= max_iterations {
            let _ = channel.send(CompletionEvent::Error {
                message: format!("Max tool iterations ({max_iterations}) reached"),
            });
            return Err(AppError::Process(format!("Max tool iterations ({max_iterations}) reached")));
        }

        let names: Vec<String> = tool_calls.iter().map(|(n, _)| n.clone()).collect();
        let args: Vec<serde_json::Value> = tool_calls.iter().map(|(_, a)| a.clone()).collect();

        for (idx, name) in names.iter().enumerate() {
            let _ = channel.send(CompletionEvent::ToolCall {
                tool: name.clone(),
                args: args[idx].clone(),
            });
        }

        let futures: Vec<_> = (0..tool_calls.len())
            .map(|idx| {
                let name = names[idx].clone();
                let arg = args[idx].clone();
                let proj = proj_dir.clone();
                let wc = Arc::clone(&write_count);
                let allowlist = tool_allowlist.clone();
                let channel = channel.clone();
                let cancel_token = cancel_token.clone();
                let app_handle = app_handle.clone();
                let http = http_client.clone();
                let surl = searxng_url.clone();
                async move {
                    let skip = if name == "write_file" {
                        wc.load(Ordering::SeqCst) >= write_file_limit
                    } else {
                        false
                    };
                    if skip {
                        let output = format!("write_file: limit of {write_file_limit} writes reached. Use read_file or bash to continue verifying.");
                        return (idx, ToolExecutionResult {
                            success: false,
                            output,
                            written_path: None,
                            written_content: None,
                        });
                    }

                    // ask_user / ask_user_form handled here — no permission gate, no execute_tool call.
                    if name == "ask_user" {
                        let answer = request_ask_user(&arg, &channel, &cancel_token, &app_handle).await;
                        return (idx, ToolExecutionResult {
                            success: true,
                            output: answer,
                            written_path: None,
                            written_content: None,
                        });
                    }
                    if name == "ask_user_form" {
                        let answers_json = request_ask_user_form(&arg, &channel, &cancel_token, &app_handle).await;
                        return (idx, ToolExecutionResult {
                            success: true,
                            output: answers_json,
                            written_path: None,
                            written_content: None,
                        });
                    }

                    let should_gate = check_permission_gate(&name, permission_mode, &allowlist);

                    if should_gate {
                        let decision = request_permission(&name, &arg, &channel, &cancel_token, &app_handle).await;

                        match decision {
                            ToolPermissionDecision::Rejected => {
                                return (idx, ToolExecutionResult {
                                    success: false,
                                    output: format!("User rejected {name}"),
                                    written_path: None,
                                    written_content: None,
                                });
                            }
                            ToolPermissionDecision::AlwaysAllowed => {}
                            ToolPermissionDecision::Accepted => {}
                        }
                    }

                    let result = execute_tool(&name, &arg, app_data_dir, output_path, &proj, permission_mode, &http, &surl).await;
                    if name == "write_file" && result.success {
                        wc.fetch_add(1, Ordering::SeqCst);
                    }
                    (idx, result)
                }
            })
            .collect();

        let mut results: Vec<(usize, ToolExecutionResult)> = join_all(futures).await;
        results.sort_by_key(|&(i, _)| i);

        for result in results {
            let idx = result.0;
            let name = &names[idx];
            let res = result.1;

            let path_opt = res.written_path.as_ref().map(|p| {
                p.strip_prefix(app_data_dir)
                    .map(|rel| rel.to_string_lossy().to_string())
                    .unwrap_or_else(|_| output_path.to_string())
            });

            let _ = channel.send(CompletionEvent::ToolResult {
                tool: name.clone(),
                success: res.success,
                output: res.output.clone(),
                path: path_opt,
                content: res.written_content.clone(),
            });

            let history_output = if res.output.len() > tool_output_history_limit {
                let truncated: String = res.output.chars().take(tool_output_history_limit).collect();
                format!("{}\n... (output truncated, {} characters total)", truncated, res.output.len())
            } else {
                res.output.clone()
            };
            history.push(tool_result_msg(name, &history_output));
        }

        iteration += 1;
    }

    let _ = channel.send(CompletionEvent::Done { done_reason: None });
    Ok(())
}
