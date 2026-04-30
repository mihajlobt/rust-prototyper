use std::path::{Path, PathBuf};
use futures_util::StreamExt;
use ollama_rs::generation::parameters::ThinkType;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;
use crate::{AppError, CompletionEvent};
use super::{executor::execute_tool, tools::build_tools};

const MAX_ITERATIONS: u8 = 10;
const MAX_WRITES: u8 = 3;
/// Maximum characters of tool output sent to the model's history. Large
/// file reads can consume excessive context tokens, so we truncate the
/// history representation while sending the full output to the frontend.
/// Matches the test binary's 500-char truncation.
const MAX_TOOL_OUTPUT_FOR_HISTORY: usize = 500;

fn project_dir(app_data_dir: &Path, output_path: &str) -> PathBuf {
    let parts: Vec<&str> = output_path.splitn(3, '/').collect();
    if parts.len() >= 2 {
        app_data_dir.join(parts[0]).join(parts[1]).join("generated")
    } else {
        app_data_dir.to_path_buf()
    }
}

/// Build a serde_json::Value message for the Ollama /api/chat endpoint.
/// Uses raw JSON to include `tool_name` on tool-role messages, which
/// ollama-rs ChatMessage does not support.
/// Per Ollama API docs: https://github.com/ollama/ollama/blob/main/docs/api.md
fn assistant_msg_with_thinking(content: &str, thinking: Option<&str>, tool_calls: &[serde_json::Value]) -> serde_json::Value {
    let mut msg = serde_json::json!({"role": "assistant", "content": content});
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

/// Deserialize a serde_json::Value tool_call from Ollama's streaming response
/// into the ToolCall struct used by executor.
fn parse_tool_call(value: &serde_json::Value) -> Option<(String, serde_json::Value)> {
    let func = value.get("function")?;
    let name = func.get("name")?.as_str()?.to_string();
    let arguments = func.get("arguments").cloned().unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
    Some((name, arguments))
}

/// Streaming response chunk from the Ollama /api/chat endpoint.
/// Includes tool_calls for agent loop support.
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

/// Stream a single agent turn using raw HTTP to the Ollama /api/chat endpoint.
/// Returns any tool calls the model made.
///
/// Manages history as Vec<serde_json::Value> instead of ollama-rs ChatMessage
/// because ChatMessage lacks a `tool_name` field for tool-role messages.
/// Per Ollama API docs, tool messages should include tool_name:
/// https://github.com/ollama/ollama/blob/main/docs/api.md
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
        body["think"] = serde_json::to_value(tt).unwrap_or(serde_json::Value::Bool(true));
    }

    let url = format!("{}/api/chat", host);
    let mut req_builder = http_client.post(&url).json(&body);
    if !api_key.is_empty() {
        req_builder = req_builder.header("Authorization", format!("Bearer {}", api_key));
    }

    let res = req_builder.send().await.map_err(|e| AppError::Http(e.to_string()))?;
    if !res.status().is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(AppError::Http(err_body));
    }

    let mut byte_stream = res.bytes_stream();
    let mut tool_calls: Vec<(String, serde_json::Value)> = vec![];
    let mut content_accumulated = String::new();
    let mut thinking_accumulated: Option<String> = None;
    let mut tool_calls_json: Vec<serde_json::Value> = vec![];
    let mut buffer = String::new();

    loop {
        tokio::select! {
            chunk_result = byte_stream.next() => {
                match chunk_result {
                    Some(Ok(chunk)) => {
                        if let Ok(chunk_str) = String::from_utf8(chunk.to_vec()) {
                            buffer.push_str(&chunk_str);
                            let mut start = 0;
                            while let Some(pos) = buffer[start..].find('\n') {
                                let line = buffer[start..start + pos].trim().to_string();
                                start = start + pos + 1;
                                if line.is_empty() { continue; }
                                if let Ok(response) = serde_json::from_str::<StreamChunk>(&line) {
                                    if !response.message.tool_calls.is_empty() {
                                        tool_calls_json = response.message.tool_calls.clone();
                                        tool_calls = response.message.tool_calls.iter()
                                            .filter_map(|v| parse_tool_call(v))
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
                                        break;
                                    }
                                }
                            }
                            buffer = buffer[start..].to_string();
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
                        break;
                    }
                }
            }
            _ = cancel_token.cancelled() => {
                drop(byte_stream);
                return Ok(tool_calls);
            }
        }
    }

    Ok(tool_calls)
}

/// Parameters for the agent loop, grouped to avoid too_many_arguments clippy warning.
pub struct AgentLoopParams<'a> {
    pub http_client: &'a reqwest::Client,
    pub host: &'a str,
    pub api_key: &'a str,
    pub model: &'a str,
    pub initial_messages_json: Vec<serde_json::Value>,
    pub think: Option<ThinkType>,
    pub app_data_dir: &'a Path,
    pub output_path: &'a str,
    pub channel: &'a Channel<CompletionEvent>,
    pub cancel_token: &'a CancellationToken,
}

pub async fn run_agent_loop(params: AgentLoopParams<'_>) -> Result<(), AppError> {
    let AgentLoopParams { http_client, host, api_key, model, initial_messages_json, think, app_data_dir, output_path, channel, cancel_token } = params;
    let proj_dir = project_dir(app_data_dir, output_path);
    let _ = tokio::fs::create_dir_all(&proj_dir).await;

    let mut history = initial_messages_json;
    let tools = build_tools();
    let tools_json = serde_json::to_value(&tools).expect("tools serialization should never fail");

    let mut iteration: u8 = 0;
    let mut write_count: u8 = 0;

    loop {
        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done);
            return Ok(());
        }

        let tool_calls = stream_turn(
            http_client, host, api_key, model,
            &mut history, think.as_ref(), &tools_json,
            channel, cancel_token,
        ).await?;

        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done);
            return Ok(());
        }

        // No tool calls → model produced a text response → done
        if tool_calls.is_empty() {
            break;
        }

        if iteration >= MAX_ITERATIONS {
            let _ = channel.send(CompletionEvent::Error {
                message: format!("Max tool iterations ({MAX_ITERATIONS}) reached"),
            });
            return Err(AppError::Process(format!("Max tool iterations ({MAX_ITERATIONS}) reached")));
        }

        for (name, args) in &tool_calls {
            if cancel_token.is_cancelled() {
                let _ = channel.send(CompletionEvent::Done);
                return Ok(());
            }

            // If the write limit was reached, skip write_file calls but allow
            // read_file and bash (for verification). Report the error to the model.
            if name == "write_file" && write_count >= MAX_WRITES {
                let _ = channel.send(CompletionEvent::ToolResult {
                    tool: name.clone(),
                    success: false,
                    output: format!("write_file: limit of {MAX_WRITES} writes reached. Use read_file or bash to continue verifying."),
                    path: None,
                    content: None,
                });
                history.push(tool_result_msg(name, &format!("write_file: limit of {MAX_WRITES} writes reached")));
                continue;
            }

            let _ = channel.send(CompletionEvent::ToolCall {
                tool: name.clone(),
                args: args.clone(),
            });

            let result = execute_tool(name, args, app_data_dir, output_path, &proj_dir).await;

            // Tool failures are pushed into history so the model can see what went
            // wrong and self-correct on the next turn. Retrying the same arguments
            // provides no benefit — if the args are invalid, retries produce the same
            // error. The model decides whether to adjust its approach.
            // See Cursor's agent harness approach:
            // https://www.cursor.com/blog/continually-improving-agent-hawk

            let path_opt = result.written_path.as_ref().map(|p| {
                p.strip_prefix(app_data_dir)
                    .map(|rel| rel.to_string_lossy().to_string())
                    .unwrap_or_else(|_| output_path.to_string())
            });

            let _ = channel.send(CompletionEvent::ToolResult {
                tool: name.clone(),
                success: result.success,
                output: result.output.clone(),
                path: path_opt,
                content: result.written_content.clone(),
            });

            if name == "write_file" && result.success {
                write_count += 1;
            }

            // Push tool result with tool_name into history for next turn.
            // Per Ollama API docs: tool messages should include tool_name
            // so the model can match results to their respective tool calls.
            // Truncate to MAX_TOOL_OUTPUT_FOR_HISTORY chars to avoid consuming
            // excessive context tokens on large file reads.
            let history_output = if result.output.len() > MAX_TOOL_OUTPUT_FOR_HISTORY {
                let truncated: String = result.output.chars().take(MAX_TOOL_OUTPUT_FOR_HISTORY).collect();
                format!("{}\n... (output truncated, {} characters total)", truncated, result.output.len())
            } else {
                result.output.clone()
            };
            history.push(tool_result_msg(name, &history_output));
        }

        // Increment iteration counter and continue — don't break after
        // write_file. Let the model self-verify via read_file or bash.
        iteration += 1;
    }

    let _ = channel.send(CompletionEvent::Done);
    Ok(())
}