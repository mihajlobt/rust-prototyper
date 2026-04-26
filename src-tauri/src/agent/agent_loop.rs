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

async fn stream_turn(
    ollama: &Ollama,
    history: Arc<Mutex<Vec<OllamaChatMessage>>>,
    request: ChatMessageRequest,
    channel: &Channel<CompletionEvent>,
) -> Result<Vec<ollama_rs::generation::tools::ToolCall>, AppError> {
    let mut tool_calls: Vec<ollama_rs::generation::tools::ToolCall> = vec![];

    let mut stream = ollama
        .send_chat_messages_with_history_stream(history, request)
        .await
        .map_err(|e| AppError::Http(e.to_string()))?;

    while let Some(result) = stream.next().await {
        let response = result.map_err(|_| AppError::Http("Ollama stream error".into()))?;
        if !response.message.tool_calls.is_empty() {
            tool_calls = response.message.tool_calls.clone();
        }
        let thinking = response.message.thinking.filter(|t| !t.is_empty());
        let text = response.message.content;
        if thinking.is_some() || !text.is_empty() {
            let _ = channel.send(CompletionEvent::Chunk { text, thinking });
        }
    }

    Ok(tool_calls)
}

pub async fn run_agent_loop(
    ollama: &Ollama,
    model: &str,
    initial_messages: Vec<OllamaChatMessage>,
    think: Option<bool>,
    app_data_dir: &Path,
    output_path: &str,
    channel: &Channel<CompletionEvent>,
) -> Result<(), AppError> {
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
        let tool_calls = stream_turn(ollama, history.clone(), request, channel).await?;

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
            // Closing turn: no tools offered — forces the model to produce a text
            // description instead of calling tools again. Mirrors the original
            // Prototyper two-turn pattern that was confirmed working in research.
            let closing = {
                let mut r = ChatMessageRequest::new(model.to_string(), vec![]);
                if let Some(true) = think {
                    r = r.think(ThinkType::True);
                }
                r
            };
            stream_turn(ollama, history.clone(), closing, channel).await?;
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
