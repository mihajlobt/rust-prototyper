use std::path::{Path, PathBuf};
use futures_util::StreamExt;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{ChatMessage as OllamaChatMessage, request::ChatMessageRequest},
        parameters::ThinkType,
    },
};
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;
use crate::{AppError, CompletionEvent};
use super::{executor::execute_tool, tools::build_tools};

const MAX_ITERATIONS: u8 = 10;

fn project_dir(app_data_dir: &Path, output_path: &str) -> PathBuf {
    // output_path = "projects/{id}/..." → generated dir is "projects/{id}/generated"
    let parts: Vec<&str> = output_path.splitn(3, '/').collect();
    if parts.len() >= 2 {
        app_data_dir.join(parts[0]).join(parts[1]).join("generated")
    } else {
        app_data_dir.to_path_buf()
    }
}

/// Stream a single agent turn, returning any tool calls the model made.
///
/// Manages history manually instead of delegating to
/// `send_chat_messages_with_history_stream` because that method only accumulates
/// text content and pushes `ChatMessage::assistant(content)` — it does NOT
/// preserve `tool_calls` in the history entry (ollama-rs src/generation/chat/mod.rs:181).
/// Without tool_calls in the assistant history message, the Ollama API receives
/// a malformed multi-turn conversation (tool role with no prior tool_call), which
/// breaks scenarios where the model calls read_file before write_file.
async fn stream_turn(
    ollama: &Ollama,
    history: &mut Vec<OllamaChatMessage>,
    mut request: ChatMessageRequest,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
) -> Result<Vec<ollama_rs::generation::tools::ToolCall>, AppError> {
    // Push new messages from the request into history, then send the full history.
    // Mirrors the message-prepend logic in send_chat_messages_with_history_stream
    // (ollama-rs src/generation/chat/mod.rs:158-164).
    for m in std::mem::take(&mut request.messages) {
        history.push(m);
    }
    request.messages = history.clone();

    let mut stream = ollama
        .send_chat_messages_stream(request)
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    let mut tool_calls: Vec<ollama_rs::generation::tools::ToolCall> = vec![];
    let mut content_accumulated = String::new();

    loop {
        tokio::select! {
            result = stream.next() => {
                match result {
                    Some(Ok(response)) => {
                        // Tool calls arrive on the done=true chunk (final chunk only)
                        if !response.message.tool_calls.is_empty() {
                            tool_calls = response.message.tool_calls.clone();
                        }
                        let thinking = response.message.thinking.filter(|t| !t.is_empty());
                        let text = response.message.content.clone();
                        if !text.is_empty() {
                            content_accumulated.push_str(&text);
                        }
                        if thinking.is_some() || !text.is_empty() {
                            let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                        }
                        if response.done {
                            // Push the correct assistant message — content + tool_calls.
                            // This is the fix for the missing tool_calls bug described above.
                            let mut assistant_msg = OllamaChatMessage::assistant(content_accumulated.clone());
                            assistant_msg.tool_calls = tool_calls.clone();
                            history.push(assistant_msg);
                            break;
                        }
                    }
                    Some(Err(_)) => return Err(AppError::Http("Ollama stream error".into())),
                    None => {
                        // Stream ended without a done=true chunk — push what we have
                        let mut assistant_msg = OllamaChatMessage::assistant(content_accumulated.clone());
                        assistant_msg.tool_calls = tool_calls.clone();
                        history.push(assistant_msg);
                        break;
                    }
                }
            }
            _ = cancel_token.cancelled() => {
                // Cancellation — drop stream to close the HTTP connection
                drop(stream);
                return Ok(tool_calls);
            }
        }
    }

    Ok(tool_calls)
}

/// Parameters for the agent loop, grouped to avoid too_many_arguments clippy warning.
pub struct AgentLoopParams<'a> {
    pub ollama: &'a Ollama,
    pub model: &'a str,
    pub initial_messages: Vec<OllamaChatMessage>,
    pub think: Option<bool>,
    pub app_data_dir: &'a Path,
    pub output_path: &'a str,
    pub channel: &'a Channel<CompletionEvent>,
    pub cancel_token: &'a CancellationToken,
}

pub async fn run_agent_loop(params: AgentLoopParams<'_>) -> Result<(), AppError> {
    let AgentLoopParams { ollama, model, initial_messages, think, app_data_dir, output_path, channel, cancel_token } = params;
    let proj_dir = project_dir(app_data_dir, output_path);
    let _ = tokio::fs::create_dir_all(&proj_dir).await;

    let mut history: Vec<OllamaChatMessage> = vec![];
    let tools = build_tools();

    let mut request = ChatMessageRequest::new(model.to_string(), initial_messages)
        .tools(tools.clone());
    if let Some(true) = think {
        request = request.think(ThinkType::True);
    }

    let mut iteration: u8 = 0;

    loop {
        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done);
            return Ok(());
        }

        let tool_calls = stream_turn(ollama, &mut history, request, channel, cancel_token).await?;

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

        let mut wrote_file = false;

        for call in &tool_calls {
            if cancel_token.is_cancelled() {
                let _ = channel.send(CompletionEvent::Done);
                return Ok(());
            }

            let name = &call.function.name;
            let args = &call.function.arguments;

            let _ = channel.send(CompletionEvent::ToolCall {
                tool: name.clone(),
                args: args.clone(),
            });

            let result = execute_tool(name, args, app_data_dir, output_path, &proj_dir).await;

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
                wrote_file = true;
            }

            history.push(OllamaChatMessage::tool(result.output));
        }

        if wrote_file {
            break;
        }

        // No write_file this turn (e.g. read_file / bash only) → continue with tools
        request = {
            let mut r = ChatMessageRequest::new(model.to_string(), vec![])
                .tools(tools.clone());
            if let Some(true) = think {
                r = r.think(ThinkType::True);
            }
            r
        };

        iteration += 1;
    }

    let _ = channel.send(CompletionEvent::Done);
    Ok(())
}
