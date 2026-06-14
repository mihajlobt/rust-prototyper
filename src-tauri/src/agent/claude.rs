use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicU8, Ordering};
use futures::future::join_all;
use futures_util::StreamExt;
use ollama_rs::generation::parameters::ThinkType;
use tauri::ipc::Channel;
use tokio_util::sync::CancellationToken;

use crate::{AppError, CompletionEvent, TokenUsage};
use crate::commands::ai::ToolPermissionDecision;
use super::agent_loop::{
    check_permission_gate, request_ask_user, request_ask_user_form, request_permission,
    project_dir, setup_project_dir, MAX_ITERATIONS, MAX_WRITES, MAX_TOOL_OUTPUT_FOR_HISTORY,
};
use super::executor::{execute_tool, execute_task_list, resolve_tool_search};
use super::tools::build_tools;
use super::AgentLoopParams;

const ANTHROPIC_VERSION: &str = "2023-06-01";
// max_tokens for standard vs thinking-enabled requests
const MAX_TOKENS: u32 = 8192;
const MAX_TOKENS_THINKING: u32 = 16000;
const THINKING_BUDGET_TOKENS: u32 = 8000;

/// Convert tools from OpenAI/Ollama format (parameters) to Anthropic format (input_schema).
fn tools_to_claude_format(tools_json: &serde_json::Value) -> serde_json::Value {
    let arr = match tools_json.as_array() {
        Some(a) => a,
        None => return serde_json::json!([]),
    };
    serde_json::Value::Array(arr.iter().map(|t| {
        let func = &t["function"];
        serde_json::json!({
            "name": func["name"],
            "description": func["description"],
            "input_schema": func["parameters"],
        })
    }).collect())
}

/// Extract system prompt and Claude-compatible user/assistant messages from history.
pub fn extract_claude_messages(history: &[serde_json::Value]) -> (String, Vec<serde_json::Value>) {
    let mut system = String::new();
    let mut messages: Vec<serde_json::Value> = Vec::new();
    for msg in history {
        let role = msg["role"].as_str().unwrap_or("");
        match role {
            "system" => {
                system = msg["content"].as_str().unwrap_or("").to_string();
            }
            "user" | "assistant" => {
                let content = &msg["content"];
                // Content may already be a string or a block array (from multi-turn history)
                if content.is_array() {
                    messages.push(serde_json::json!({ "role": role, "content": content }));
                } else {
                    let text = content.as_str().unwrap_or("");
                    if !text.is_empty() {
                        messages.push(serde_json::json!({ "role": role, "content": text }));
                    }
                }
            }
            _ => {}
        }
    }
    (system, messages)
}

/// Stream one LLM turn against the Anthropic Messages API.
/// Returns (text, thinking, tool_calls: Vec<(name, args, tool_use_id)>, assistant_msg_for_history, usage).
async fn stream_turn_claude(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system: &str,
    messages: &[serde_json::Value],
    tools_claude: &serde_json::Value,
    enable_thinking: bool,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
) -> Result<(String, Option<String>, Vec<(String, serde_json::Value, String)>, serde_json::Value, TokenUsage), AppError> {
    let max_tokens = if enable_thinking { MAX_TOKENS_THINKING } else { MAX_TOKENS };
    let mut body = serde_json::json!({
        "model": model,
        "max_tokens": max_tokens,
        "stream": true,
        "messages": messages,
        "tools": tools_claude,
    });
    if !system.is_empty() {
        body["system"] = serde_json::Value::String(system.to_string());
    }
    if enable_thinking {
        body["thinking"] = serde_json::json!({
            "type": "enabled",
            "budget_tokens": THINKING_BUDGET_TOKENS,
        });
    }

    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json")
        .json(&body)
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

    // Per-block state: index → (block_type, tool_use_id, tool_name, accumulated_text_or_json)
    let mut blocks: HashMap<usize, (String, String, String, String)> = HashMap::new();
    let mut text_acc = String::new();
    let mut thinking_acc = String::new();
    let mut tool_calls: Vec<(String, serde_json::Value, String)> = Vec::new();
    let mut assistant_content: Vec<serde_json::Value> = Vec::new();
    let mut usage = TokenUsage::default();
    let mut current_event = String::new();
    let mut line_buf = String::new();
    let mut byte_stream = res.bytes_stream();

    'outer: loop {
        tokio::select! {
            chunk = byte_stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        for ch in String::from_utf8_lossy(&bytes).chars() {
                            if ch == '\n' {
                                let line = std::mem::take(&mut line_buf);
                                if line.is_empty() {
                                    current_event.clear();
                                } else if let Some(ev) = line.strip_prefix("event: ") {
                                    current_event = ev.trim().to_string();
                                } else if let Some(data) = line.strip_prefix("data: ") {
                                    let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else { continue };
                                    match current_event.as_str() {
                                        "message_start" => {
                                            // https://docs.anthropic.com/en/api/messages-streaming#message-start
                                            if let Some(n) = json["message"]["usage"]["input_tokens"].as_u64() {
                                                usage.prompt_tokens = n;
                                            }
                                            if let Some(n) = json["message"]["usage"]["output_tokens"].as_u64() {
                                                usage.completion_tokens = n;
                                            }
                                        }
                                        "message_delta" => {
                                            // https://docs.anthropic.com/en/api/messages-streaming#message-delta
                                            // `output_tokens` here is the running total for the message.
                                            if let Some(n) = json["usage"]["output_tokens"].as_u64() {
                                                usage.completion_tokens = n;
                                            }
                                        }
                                        "content_block_start" => {
                                            let idx = json["index"].as_u64().unwrap_or(0) as usize;
                                            let cb = &json["content_block"];
                                            let block_type = cb["type"].as_str().unwrap_or("").to_string();
                                            let tool_id   = cb["id"].as_str().unwrap_or("").to_string();
                                            let tool_name = cb["name"].as_str().unwrap_or("").to_string();
                                            blocks.insert(idx, (block_type, tool_id, tool_name, String::new()));
                                        }
                                        "content_block_delta" => {
                                            let idx = json["index"].as_u64().unwrap_or(0) as usize;
                                            let delta = &json["delta"];
                                            match delta["type"].as_str().unwrap_or("") {
                                                "text_delta" => {
                                                    let text = delta["text"].as_str().unwrap_or("");
                                                    text_acc.push_str(text);
                                                    if let Some(b) = blocks.get_mut(&idx) { b.3.push_str(text); }
                                                    let _ = channel.send(CompletionEvent::Chunk { text: text.to_string(), thinking: None });
                                                }
                                                "thinking_delta" => {
                                                    let t = delta["thinking"].as_str().unwrap_or("");
                                                    thinking_acc.push_str(t);
                                                    if let Some(b) = blocks.get_mut(&idx) { b.3.push_str(t); }
                                                    let _ = channel.send(CompletionEvent::Chunk { text: String::new(), thinking: Some(t.to_string()) });
                                                }
                                                "input_json_delta" => {
                                                    let partial = delta["partial_json"].as_str().unwrap_or("");
                                                    if let Some(b) = blocks.get_mut(&idx) { b.3.push_str(partial); }
                                                }
                                                _ => {}
                                            }
                                        }
                                        "content_block_stop" => {
                                            let idx = json["index"].as_u64().unwrap_or(0) as usize;
                                            if let Some((block_type, tool_id, tool_name, content)) = blocks.remove(&idx) {
                                                match block_type.as_str() {
                                                    "text" if !content.is_empty() => {
                                                        assistant_content.push(serde_json::json!({ "type": "text", "text": content }));
                                                    }
                                                    "tool_use" => {
                                                        let args: serde_json::Value = serde_json::from_str(&content)
                                                            .unwrap_or(serde_json::json!({}));
                                                        assistant_content.push(serde_json::json!({
                                                            "type": "tool_use",
                                                            "id": tool_id,
                                                            "name": tool_name,
                                                            "input": args.clone(),
                                                        }));
                                                        tool_calls.push((tool_name, args, tool_id));
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }
                                        "message_stop" => break 'outer,
                                        _ => {}
                                    }
                                }
                            } else {
                                line_buf.push(ch);
                            }
                        }
                    }
                    Some(Err(e)) => return Err(AppError::Http(e.to_string())),
                    None => break,
                }
            }
            _ = cancel_token.cancelled() => {
                drop(byte_stream);
                break;
            }
        }
    }

    let assistant_msg = serde_json::json!({ "role": "assistant", "content": assistant_content });
    let thinking_opt = if thinking_acc.is_empty() { None } else { Some(thinking_acc) };
    Ok((text_acc, thinking_opt, tool_calls, assistant_msg, usage))
}

pub async fn run_agent_loop_claude(params: AgentLoopParams<'_>) -> Result<(), AppError> {
    let AgentLoopParams {
        provider: _,
        http_client, api_key, model,
        initial_messages_json, think,
        app_data_dir, output_path,
        channel, cancel_token, app_handle,
        permission_mode, tool_allowlist, max_tool_calls, tool_filter,
        // unused for Claude:
        host: _, model_family: _,
        searxng_url,
        write_file_limit,
        tool_output_history_limit,
    } = params;

    let enable_thinking = matches!(think.as_ref(), Some(ThinkType::True));

    let max_iterations = max_tool_calls.filter(|&n| n > 0).unwrap_or(MAX_ITERATIONS);
    let write_file_limit = write_file_limit.filter(|&n| n > 0).unwrap_or(MAX_WRITES);
    let tool_output_history_limit = tool_output_history_limit.unwrap_or(MAX_TOOL_OUTPUT_FOR_HISTORY);
    let proj_dir = project_dir(app_data_dir, output_path);
    let _ = tokio::fs::create_dir_all(&proj_dir).await;
    setup_project_dir(&proj_dir).await;

    let all_tools = build_tools();
    let tools: Vec<_> = if tool_filter.is_empty() {
        all_tools
    } else {
        all_tools.into_iter().filter(|t| tool_filter.contains(&t.function.name)).collect()
    };
    let tools_json = serde_json::to_value(&tools).expect("tools serialization should never fail");
    let tools_claude = tools_to_claude_format(&tools_json);
    // This loop never defers tool schemas (unlike run_agent_loop), so tool_search has
    // nothing to "select:" — it's search-only here, and this set is always empty.
    let no_deferred_tools: HashSet<String> = HashSet::new();

    let (system, mut messages) = extract_claude_messages(&initial_messages_json);
    let write_count = Arc::new(AtomicU8::new(0));
    let mut iteration: u8 = 0;
    let mut latest_usage = crate::TokenUsage::default();

    loop {
        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done { done_reason: None, usage: Some(latest_usage) });
            return Ok(());
        }

        let (_, _, tool_calls, assistant_msg, turn_usage) = stream_turn_claude(
            http_client, api_key, model,
            &system, &messages, &tools_claude,
            enable_thinking, channel, cancel_token,
        ).await?;
        latest_usage = turn_usage;

        if cancel_token.is_cancelled() {
            let _ = channel.send(CompletionEvent::Done { done_reason: None, usage: Some(latest_usage) });
            return Ok(());
        }

        messages.push(assistant_msg);

        if tool_calls.is_empty() {
            break;
        }

        if iteration >= max_iterations {
            let _ = channel.send(CompletionEvent::Error {
                message: format!("Max tool iterations ({max_iterations}) reached"),
            });
            return Err(AppError::Process(format!("Max tool iterations ({max_iterations}) reached")));
        }

        let names: Vec<String>         = tool_calls.iter().map(|(n, _, _)| n.clone()).collect();
        let args:  Vec<serde_json::Value> = tool_calls.iter().map(|(_, a, _)| a.clone()).collect();
        let ids:   Vec<String>         = tool_calls.iter().map(|(_, _, id)| id.clone()).collect();

        for (idx, name) in names.iter().enumerate() {
            let _ = channel.send(CompletionEvent::ToolCall { tool: name.clone(), args: args[idx].clone() });
        }

        let futures: Vec<_> = (0..tool_calls.len()).map(|idx| {
            let name        = names[idx].clone();
            let arg         = args[idx].clone();
            let proj        = proj_dir.clone();
            let wc          = Arc::clone(&write_count);
            let allowlist   = tool_allowlist.clone();
            let channel     = channel.clone();
            let cancel_token = cancel_token.clone();
            let app_handle  = app_handle.clone();
            let app_data_dir = app_data_dir.to_path_buf();
            let output_path  = output_path.to_string();
            let http        = http_client.clone();
            let surl        = searxng_url.clone();
            let write_limit = write_file_limit;
            let tools_ref   = &tools;
            let no_deferred = &no_deferred_tools;
            async move {
                if name == "write_file" && wc.load(Ordering::SeqCst) >= write_limit {
                    return (idx, crate::agent::executor::ToolExecutionResult {
                        success: false,
                        output: format!("write_file: limit of {write_limit} writes reached"),
                        written_path: None,
                        written_content: None,
                    });
                }

                if name == "ask_user" {
                    let answer = request_ask_user(&arg, &channel, &cancel_token, &app_handle).await;
                    return (idx, crate::agent::executor::ToolExecutionResult {
                        success: true, output: answer, written_path: None, written_content: None,
                    });
                }
                if name == "ask_user_form" {
                    let answers = request_ask_user_form(&arg, &channel, &cancel_token, &app_handle).await;
                    return (idx, crate::agent::executor::ToolExecutionResult {
                        success: true, output: answers, written_path: None, written_content: None,
                    });
                }
                // task_list / tool_search: same no-gate, no-execute_tool treatment as in
                // run_agent_loop (agent_loop.rs) — neither has side effects beyond their
                // own bookkeeping. This loop never defers tool schemas (tools_claude is
                // built once, in full, below), so tool_search here is search-only: there's
                // nothing for `select:` to "load" and `newly_loaded` is always empty.
                if name == "task_list" {
                    let result = execute_task_list(&arg, &proj, &channel).await;
                    return (idx, result);
                }
                if name == "tool_search" {
                    let (result, _newly_loaded) = resolve_tool_search(&arg, tools_ref, no_deferred);
                    return (idx, result);
                }

                let should_gate = check_permission_gate(&name, permission_mode, &allowlist);
                if should_gate {
                    let decision = request_permission(&name, &arg, &channel, &cancel_token, &app_handle).await;
                    match decision {
                        ToolPermissionDecision::Rejected => {
                            return (idx, crate::agent::executor::ToolExecutionResult {
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

                let result = execute_tool(&name, &arg, &app_data_dir, &output_path, &proj, permission_mode, &http, &surl, &app_handle).await;
                if name == "write_file" && result.success {
                    wc.fetch_add(1, Ordering::SeqCst);
                }
                (idx, result)
            }
        }).collect();

        let mut results: Vec<(usize, crate::agent::executor::ToolExecutionResult)> = join_all(futures).await;
        results.sort_by_key(|&(i, _)| i);

        let mut tool_result_blocks: Vec<serde_json::Value> = Vec::new();

        for (idx, res) in results {
            let name = &names[idx];
            let tool_use_id = &ids[idx];

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

            tool_result_blocks.push(serde_json::json!({
                "type": "tool_result",
                "tool_use_id": tool_use_id,
                "content": history_output,
            }));
        }

        // Tool results go back as a user message with tool_result content blocks
        messages.push(serde_json::json!({
            "role": "user",
            "content": tool_result_blocks,
        }));

        iteration += 1;
    }

    let _ = channel.send(CompletionEvent::Done { done_reason: None, usage: Some(latest_usage) });
    Ok(())
}
