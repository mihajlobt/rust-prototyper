use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
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
/// Checks CancellationToken between stream chunks using tokio::select!
/// so cancellation takes effect promptly.
async fn stream_turn(
    ollama: &Ollama,
    history: Arc<Mutex<Vec<OllamaChatMessage>>>,
    request: ChatMessageRequest,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
) -> Result<Vec<ollama_rs::generation::tools::ToolCall>, AppError> {
    let mut tool_calls: Vec<ollama_rs::generation::tools::ToolCall> = vec![];

    let mut stream = ollama
        .send_chat_messages_with_history_stream(history, request)
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    loop {
        tokio::select! {
            result = stream.next() => {
                match result {
                    Some(Ok(response)) => {
                        if !response.message.tool_calls.is_empty() {
                            tool_calls = response.message.tool_calls.clone();
                        }
                        let thinking = response.message.thinking.filter(|t| !t.is_empty());
                        let text = response.message.content;
                        if thinking.is_some() || !text.is_empty() {
                            let _ = channel.send(CompletionEvent::Chunk { text, thinking });
                        }
                    }
                    Some(Err(_)) => return Err(AppError::Http("Ollama stream error".into())),
                    None => return Ok(tool_calls),
                }
            }
            _ = cancel_token.cancelled() => {
                // Cancellation — drop stream to close the HTTP connection
                drop(stream);
                return Ok(tool_calls);
            }
        }
    }
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

    let history: Arc<Mutex<Vec<OllamaChatMessage>>> = Arc::new(Mutex::new(vec![]));
    let tools = build_tools();

    let mut request = ChatMessageRequest::new(model.to_string(), initial_messages)
        .tools(tools.clone());
    if let Some(true) = think {
        request = request.think(ThinkType::True);
    }

    let mut iteration: u8 = 0;

    loop {
        // Check cancellation before starting a new iteration
        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done);
            return Ok(());
        }

        let tool_calls = stream_turn(ollama, history.clone(), request, channel, cancel_token).await?;

        // If cancelled during stream_turn, exit cleanly
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
            // Check cancellation before each tool execution
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

            history.lock().unwrap().push(OllamaChatMessage::tool(result.output));
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