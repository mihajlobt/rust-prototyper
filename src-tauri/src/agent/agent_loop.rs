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
use crate::commands::ai::{ToolPermissionDecision, ToolPermissionMode};
use crate::{AppError, CompletionEvent};
use super::{executor::{execute_tool, ToolExecutionResult}, tools::build_tools};

const MAX_ITERATIONS: u8 = 20;
const MAX_WRITES: u8 = 3;
const MAX_TOOL_OUTPUT_FOR_HISTORY: usize = 5000;

fn project_dir(app_data_dir: &Path, output_path: &str) -> PathBuf {
    let parts: Vec<&str> = output_path.splitn(3, '/').collect();
    if parts.len() >= 2 {
        app_data_dir.join(parts[0]).join(parts[1])
    } else {
        app_data_dir.to_path_buf()
    }
}

async fn setup_project_dir(proj_dir: &Path) {
    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::symlink;

        let component_preview = proj_dir.join("component-preview");
        if component_preview.exists() {
            let link = proj_dir.join("node_modules");
            if !link.exists() {
                let _ = symlink("component-preview/node_modules", &link);
            }

            let tsconfig = proj_dir.join("tsconfig.check.json");
            let content = r#"{
  "extends": "./component-preview/tsconfig.app.json",
  "compilerOptions": {
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "types": [],
    "typeRoots": ["./component-preview/node_modules/@types"]
  },
  "include": [
    "components/**/*.tsx",
    "components/**/*.ts",
    "screens/**/*.tsx",
    "screens/**/*.ts"
  ]
}
"#;
            let _ = tokio::fs::write(&tsconfig, content).await;

            // Symlink component-preview/src/data → ../../data so that @/data imports
            // in generated components resolve to the project-level data/ directory.
            let src_dir = component_preview.join("src");
            if src_dir.exists() {
                let data_link = src_dir.join("data");
                if !data_link.exists() {
                    let _ = symlink("../../data", &data_link);
                }
            }

            // Symlink screen-preview/src/screens → ../../../screens so that @/screens/{id}/screen
            // imports in routes.ts resolve to the project-level screens/ directory.
            let screen_preview = proj_dir.join("screen-preview");
            let screen_src_dir = screen_preview.join("src");
            if screen_src_dir.exists() {
                let screens_link = screen_src_dir.join("screens");
                if !screens_link.exists() {
                    let _ = symlink("../../../screens", &screens_link);
                }
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
fn check_permission_gate(
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
async fn request_permission(
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

pub struct AgentLoopParams<'a> {
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
}

pub async fn run_agent_loop(params: AgentLoopParams<'_>) -> Result<(), AppError> {
    let AgentLoopParams { http_client, host, api_key, model, model_family, initial_messages_json, think, app_data_dir, output_path, channel, cancel_token, app_handle, permission_mode, tool_allowlist } = params;
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
    let tools = build_tools();
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

        if iteration >= MAX_ITERATIONS {
            let _ = channel.send(CompletionEvent::Error {
                message: format!("Max tool iterations ({MAX_ITERATIONS}) reached"),
            });
            return Err(AppError::Process(format!("Max tool iterations ({MAX_ITERATIONS}) reached")));
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
                let permission_mode = permission_mode;
                let channel = channel.clone();
                let cancel_token = cancel_token.clone();
                let app_handle = app_handle.clone();
                async move {
                    let skip = if name == "write_file" {
                        wc.load(Ordering::SeqCst) >= MAX_WRITES
                    } else {
                        false
                    };
                    if skip {
                        let output = format!("write_file: limit of {MAX_WRITES} writes reached. Use read_file or bash to continue verifying.");
                        return (idx, ToolExecutionResult {
                            success: false,
                            output,
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
                            ToolPermissionDecision::AlwaysAllowed => {
                                // Added to allowlist - execute the tool after showing this message
                                let _ = channel.send(CompletionEvent::ToolResult {
                                    tool: name.clone(),
                                    success: true,
                                    output: format!("Added {name} to allowlist, executing..."),
                                    path: None,
                                    content: None,
                                });
                            }
                            ToolPermissionDecision::Accepted => {}
                        }
                    }

                    let result = execute_tool(&name, &arg, app_data_dir, output_path, &proj).await;
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

            let history_output = if res.output.len() > MAX_TOOL_OUTPUT_FOR_HISTORY {
                let truncated: String = res.output.chars().take(MAX_TOOL_OUTPUT_FOR_HISTORY).collect();
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
