//! Cursor IDE chat experience replication test.
//!
//! Validates that the Ollama streaming agent loop produces ALL intermediate states
//! a Cursor-like IDE needs: thinking, text chunks, tool-call start, tool result,
//! continuation text, second tool call, second tool result, and final text.
//!
//! This mirrors the CompletionEvent enum from the Tauri app:
//!   Chunk { text, thinking }  — streaming text + optional thinking
//!   ToolCall { tool, args }   — model invokes a tool
//!   ToolResult { tool, success, output, path?, content? } — tool execution result
//!   Done                      — stream complete
//!
//! Usage:
//!   Local:  cargo run --bin test_cursor_chat -- --local
//!   Cloud:  cargo run --bin test_cursor_chat -- --cloud <host> <api_key>
//!
//! The model must execute this flow:
//!   1. THINK (extended thinking before responding)
//!   2. Text about reading the file first
//!   3. ToolCall → read_file
//!   4. ToolResult ← file contents
//!   5. Text describing what was read and what changes will be made
//!   6. ToolCall → write_file
//!   7. ToolResult ← write confirmation
//!   8. Final text summary

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use futures_util::StreamExt;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{ChatMessage, request::ChatMessageRequest},
        parameters::ThinkType,
        tools::{ToolCall, ToolInfo, ToolType, ToolFunctionInfo},
    },
};
use schemars::{JsonSchema, generate::SchemaSettings};
use serde::Deserialize;
use tokio::time::sleep;

/// Thinking level for models. GPT-OSS requires string levels ("low"/"medium"/"high"),
/// most other models accept boolean (true/false). This enum abstracts over both.
#[derive(Clone, Copy, Debug)]
enum ThinkLevel {
    None,
    Bool,    // ThinkType::True — works for most models (qwen, gemma, etc.)
    Medium,  // ThinkType::Medium — required for gpt-oss which ignores booleans
}

impl ThinkLevel {
    fn to_think_type(self) -> Option<ThinkType> {
        match self {
            ThinkLevel::None => None,
            ThinkLevel::Bool => Some(ThinkType::True),
            ThinkLevel::Medium => Some(ThinkType::Medium),
        }
    }

    fn display(self) -> &'static str {
        match self {
            ThinkLevel::None => "none",
            ThinkLevel::Bool => "true (bool)",
            ThinkLevel::Medium => "medium (gpt-oss)",
        }
    }
}

// ─── CompletionEvent — mirrors src-tauri/src/commands/ai.rs ──────────────────

#[derive(Clone, Debug)]
enum CompletionEvent {
    Chunk { text: String, thinking: Option<String> },
    ToolCall { tool: String, args: serde_json::Value },
    ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
    Done,
    Error { message: String },
}

impl CompletionEvent {
    fn label(&self) -> &'static str {
        match self {
            Self::Chunk { .. } => "Chunk",
            Self::ToolCall { .. } => "ToolCall",
            Self::ToolResult { .. } => "ToolResult",
            Self::Done => "Done",
            Self::Error { .. } => "Error",
        }
    }
}

// ─── Tool schema definitions — mirrors src-tauri/src/agent/tools.rs ──────────

#[derive(Deserialize, JsonSchema)]
struct WriteFileArgs {
    /// Raw source code to write. NOT JSON — just the code.
    pub content: String,
}

#[derive(Deserialize, JsonSchema)]
struct ReadFileArgs {
    /// Relative file path to read
    pub path: String,
}

#[derive(Deserialize, JsonSchema)]
struct BashArgs {
    /// Shell command to run (30-second timeout)
    pub command: String,
}

fn make_schema<T: JsonSchema>() -> schemars::Schema {
    let mut settings = SchemaSettings::draft07();
    settings.inline_subschemas = true;
    settings.into_generator().into_root_schema_for::<T>()
}

fn build_tools() -> Vec<ToolInfo> {
    vec![
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "write_file".to_string(),
                description: "Write raw source code to a file. Pass only the content parameter — the destination path is fixed by the system. The content must be raw code — NOT a JSON object, NOT wrapped in an envelope with code/commentary keys. Just the raw code itself.".to_string(),
                parameters: make_schema::<WriteFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "read_file".to_string(),
                description: "Read the contents of a file. Use this to inspect existing code before modifying it.".to_string(),
                parameters: make_schema::<ReadFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "bash".to_string(),
                description: "Run a shell command. Use for checking files, running linters, or inspecting directory structure. 30-second timeout.".to_string(),
                parameters: make_schema::<BashArgs>(),
            },
        },
    ]
}

// ─── Tool executor — mirrors src-tauri/src/agent/executor.rs ─────────────────

struct ToolExecResult {
    success: bool,
    output: String,
    written_path: Option<PathBuf>,
    written_content: Option<String>,
}

async fn execute_tool(name: &str, args: &serde_json::Value, work_dir: &Path) -> ToolExecResult {
    match name {
        "write_file" => {
            let parsed = serde_json::from_value::<WriteFileArgs>(args.clone())
                .unwrap_or_else(|_| WriteFileArgs { content: String::new() });
            let target = work_dir.join("output.tsx");
            if let Some(parent) = target.parent() {
                let _ = tokio::fs::create_dir_all(parent).await;
            }
            match tokio::fs::write(&target, &parsed.content).await {
                Ok(()) => ToolExecResult {
                    success: true,
                    output: "Written: output.tsx".to_string(),
                    written_path: Some(target),
                    written_content: Some(parsed.content),
                },
                Err(err) => ToolExecResult {
                    success: false,
                    output: format!("write_file error: {err}"),
                    written_path: None,
                    written_content: None,
                },
            }
        }
        "read_file" => {
            let parsed = serde_json::from_value::<ReadFileArgs>(args.clone())
                .unwrap_or_else(|_| ReadFileArgs { path: String::new() });
            if parsed.path.contains("..") {
                return ToolExecResult {
                    success: false, output: "path traversal denied".into(),
                    written_path: None, written_content: None,
                };
            }
            let target = work_dir.join(&parsed.path);
            match tokio::fs::read_to_string(&target).await {
                Ok(contents) => ToolExecResult {
                    success: true,
                    output: contents,
                    written_path: None,
                    written_content: None,
                },
                Err(err) => ToolExecResult {
                    success: false,
                    output: format!("read_file error: {err}"),
                    written_path: None,
                    written_content: None,
                },
            }
        }
        "bash" => {
            let parsed = serde_json::from_value::<BashArgs>(args.clone())
                .unwrap_or_else(|_| BashArgs { command: "echo ''".to_string() });
            match tokio::process::Command::new("sh")
                .arg("-c")
                .arg(&parsed.command)
                .current_dir(work_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
            {
                Err(err) => ToolExecResult {
                    success: false, output: format!("spawn error: {err}"),
                    written_path: None, written_content: None,
                },
                Ok(child) => match tokio::time::timeout(Duration::from_secs(30), child.wait_with_output()).await {
                    Ok(Ok(out)) => {
                        let combined = format!(
                            "{}{}",
                            String::from_utf8_lossy(&out.stdout),
                            String::from_utf8_lossy(&out.stderr)
                        );
                        ToolExecResult {
                            success: out.status.success(),
                            output: if combined.trim().is_empty() { "(no output)".into() } else { combined },
                            written_path: None, written_content: None,
                        }
                    }
                    Ok(Err(err)) => ToolExecResult {
                        success: false, output: format!("bash error: {err}"),
                        written_path: None, written_content: None,
                    },
                    Err(_) => ToolExecResult {
                        success: false, output: "bash: timed out".into(),
                        written_path: None, written_content: None,
                    },
                },
            }
        }
        _ => ToolExecResult {
            success: false, output: format!("unknown tool: {name}"),
            written_path: None, written_content: None,
        },
    }
}

// ─── Agent loop — diverges from production src-tauri/src/agent/agent_loop.rs ─────
//
// The production agent loop uses raw HTTP streaming (not ollama-rs) and includes
// tool_name in history messages, has a write_count guard instead of wrote_file→break,
// and truncates tool output in history. This test binary uses the simpler ollama-rs
// ChatMessage approach and still breaks on write_file for simplicity.
// Key divergence points:
//   - Production: Vec<serde_json::Value> history with tool_name
//   - Test: Vec<ChatMessage> history without tool_name (ollama-rs lacks the field)
//   - Production: raw HTTP streaming with StreamChunk deserialization
//   - Test: ollama-rs send_chat_messages_stream
//   - Production: write_count guard (MAX_WRITES=3), continues after write
//   - Test: wrote_file→break (stops after first write)
//   - Production: truncates tool output to 500 chars in history
//   - Test: no truncation

const MAX_ITERATIONS: u8 = 10;

/// Stream a single model turn, emitting CompletionEvents for every chunk.
/// Returns tool_calls if the model invoked any, and mutates history correctly.
async fn stream_turn(
    ollama: &Ollama,
    history: &mut Vec<ChatMessage>,
    mut request: ChatMessageRequest,
    events: &mut Vec<CompletionEvent>,
) -> Result<Vec<ToolCall>, String> {
    // Push new messages from request into history, then send full history.
    // Mirrors agent_loop.rs lines 46-49.
    for message in std::mem::take(&mut request.messages) {
        history.push(message);
    }
    request.messages = history.clone();

    let mut stream = ollama
        .send_chat_messages_stream(request)
        .await
        .map_err(|err| format!("Ollama stream error: {err}"))?;

    let mut tool_calls: Vec<ToolCall> = vec![];
    let mut content_accumulated = String::new();

    while let Some(result) = stream.next().await {
        match result {
            Ok(response) => {
                // Tool calls arrive on the done=true chunk (final chunk)
                if !response.message.tool_calls.is_empty() {
                    tool_calls = response.message.tool_calls.clone();
                }

                let thinking = response.message.thinking.filter(|text| !text.is_empty());
                let text = response.message.content.clone();

                if !text.is_empty() {
                    content_accumulated.push_str(&text);
                }

                // Emit Chunk event for every non-empty text or thinking
                if thinking.is_some() || !text.is_empty() {
                    events.push(CompletionEvent::Chunk { text, thinking });
                }

                if response.done {
                    // Push correct assistant message with tool_calls attached.
                    // This is the fix for the ollama-rs missing tool_calls bug.
                    let mut assistant_msg = ChatMessage::assistant(content_accumulated.clone());
                    assistant_msg.tool_calls = tool_calls.clone();
                    history.push(assistant_msg);
                    break;
                }
            }
            Err(_) => return Err("Ollama stream chunk error".into()),
        }
    }

    Ok(tool_calls)
}

/// Full agent loop result — tracks all intermediate states for verification.
struct AgentRunResult {
    events: Vec<CompletionEvent>,
    text_chunks_collected: Vec<String>,
    thinking_chunks_collected: Vec<String>,
    tool_calls_made: Vec<String>,
    tool_results_received: Vec<(String, bool)>,
    file_written: bool,
    written_path: Option<PathBuf>,
    written_content: Option<String>,
    iterations: u8,
}

/// Run the full agentic loop, emitting events at every step.
/// This is the loop that produces the Cursor IDE experience.
async fn run_cursor_chat_loop(
    ollama: &Ollama,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    work_dir: &Path,
    think_level: ThinkLevel,
) -> Result<AgentRunResult, String> {
    let tools = build_tools();
    let mut history: Vec<ChatMessage> = vec![];
    let mut events: Vec<CompletionEvent> = vec![];

    let mut request = ChatMessageRequest::new(model.to_string(), vec![
        ChatMessage::system(system_prompt.to_string()),
        ChatMessage::user(user_prompt.to_string()),
    ])
    .tools(tools.clone());

    if let Some(think) = think_level.to_think_type() {
        request = request.think(think);
    }

    let mut result = AgentRunResult {
        events: vec![],
        text_chunks_collected: vec![],
        thinking_chunks_collected: vec![],
        tool_calls_made: vec![],
        tool_results_received: vec![],
        file_written: false,
        written_path: None,
        written_content: None,
        iterations: 0,
    };

    loop {
        let tool_calls = stream_turn(ollama, &mut history, request, &mut events).await?;

        // No tool calls → model produced text-only response → done
        if tool_calls.is_empty() {
            break;
        }

        if result.iterations >= MAX_ITERATIONS {
            events.push(CompletionEvent::Error {
                message: format!("Max tool iterations ({MAX_ITERATIONS}) reached"),
            });
            break;
        }

        let mut wrote_file = false;

        for call in &tool_calls {
            let tool_name = &call.function.name;
            let tool_args = &call.function.arguments;

            // Emit ToolCall event (what Cursor shows as "calling tool...")
            events.push(CompletionEvent::ToolCall {
                tool: tool_name.clone(),
                args: tool_args.clone(),
            });
            result.tool_calls_made.push(tool_name.clone());

            // Execute the tool
            let tool_result = execute_tool(tool_name, tool_args, work_dir).await;

            // Emit ToolResult event (what Cursor shows as tool result)
            let path_opt = tool_result.written_path.as_ref().map(|path| {
                path.strip_prefix(work_dir)
                    .map(|relative| relative.to_string_lossy().to_string())
                    .unwrap_or_else(|_| "output.tsx".to_string())
            });

            events.push(CompletionEvent::ToolResult {
                tool: tool_name.clone(),
                success: tool_result.success,
                output: tool_result.output.chars().take(500).collect(),
                path: path_opt,
                content: tool_result.written_content.clone(),
            });

            result.tool_results_received.push((tool_name.clone(), tool_result.success));

            if tool_name == "write_file" && tool_result.success {
                wrote_file = true;
                result.file_written = true;
                result.written_path = tool_result.written_path;
                result.written_content = tool_result.written_content.clone();
            }

            // Push tool result into history for next turn
            // ollama-rs ChatMessage::tool() creates a message with role "tool"
            history.push(ChatMessage::tool(tool_result.output.clone()));
        }

        if wrote_file {
            break;
        }

        // Non-write tools (read_file, bash) — continue with tools available
        request = {
            let mut request = ChatMessageRequest::new(model.to_string(), vec![])
                .tools(tools.clone());
            if let Some(think) = think_level.to_think_type() {
                request = request.think(think);
            }
            request
        };

        result.iterations += 1;
        sleep(Duration::from_secs(2)).await;
    }

    events.push(CompletionEvent::Done);

    // Post-process: categorize all events
    for event in &events {
        if let CompletionEvent::Chunk { text, thinking } = event {
            if !text.is_empty() {
                result.text_chunks_collected.push(text.clone());
            }
            if let Some(think_text) = thinking {
                if !think_text.is_empty() {
                    result.thinking_chunks_collected.push(think_text.clone());
                }
            }
        }
    }

    result.events = events;
    Ok(result)
}

// ─── Logging helpers — pretty-print every event like a Cursor UI ─────────────

static EVENT_COUNTER: AtomicUsize = AtomicUsize::new(1);

fn log_event(event: &CompletionEvent) {
    let sequence_number = EVENT_COUNTER.fetch_add(1, Ordering::Relaxed);
    match event {
        CompletionEvent::Chunk { text, thinking } => {
            if let Some(think_text) = thinking {
                if !think_text.is_empty() {
                    println!("  [{sequence_number:03}] 💭 THINKING: {}",
                        think_text.chars().take(120).collect::<String>()
                    );
                }
            }
            if !text.is_empty() {
                print!("  [{sequence_number:03}] 📝 CHUNK: {}", text);
                // No newline — streaming text comes in small pieces
            }
        }
        CompletionEvent::ToolCall { tool, args } => {
            println!(); // flush any accumulated Chunk text
            println!("  [{sequence_number:03}] 🔧 TOOL_CALL: {}({})", tool,
                args.to_string().chars().take(100).collect::<String>()
            );
        }
        CompletionEvent::ToolResult { tool, success, output, path, content } => {
            let icon = if *success { "✅" } else { "❌" };
            println!("  [{sequence_number:03}] {icon} TOOL_RESULT: {} (success={success})", tool);
            if let Some(path_str) = path {
                println!("       path: {path_str}");
            }
            if let Some(content_str) = content {
                println!("       content length: {} chars", content_str.len());
            }
            // Truncate large tool outputs for display
            let display_output = output.chars().take(200).collect::<String>();
            if !display_output.is_empty() {
                println!("       output: {display_output}");
            }
        }
        CompletionEvent::Done => {
            println!(); // flush
            println!("  [{sequence_number:03}] ✅ DONE");
        }
        CompletionEvent::Error { message } => {
            println!(); // flush
            println!("  [{sequence_number:03}] ❌ ERROR: {message}");
        }
    }
}

// ─── Assertion helpers ───────────────────────────────────────────────────────

fn pass(label: &str) { println!("  ✓ {label}"); }
fn fail(label: &str) { println!("  ✗ {label}"); TOTAL_FAILURES.fetch_add(1, Ordering::Relaxed); }

fn check(label: &str, ok: bool) {
    if ok { pass(label); } else { fail(label); }
}

static TOTAL_FAILURES: AtomicUsize = AtomicUsize::new(0);

// ─── Test 1: Full Cursor chat flow ───────────────────────────────────────────
//
// Forces the model through the exact Cursor IDE experience:
//   thinking → text → read_file → text → write_file → final text

async fn test_cursor_chat_flow(
    ollama: &Ollama,
    model: &str,
    work_dir: &Path,
    think_level: ThinkLevel,
    label: &str,
) {
    EVENT_COUNTER.store(1, Ordering::Relaxed);

    let system_prompt = "You are an expert React/TypeScript UI developer.

TOOL USAGE — REQUIRED:
You MUST use the provided tools to complete every task. Never output code in plain text.
- write_file: saves raw source code to disk.
- read_file: reads an existing file from disk. Use this when you need to see a file before editing.
- bash: runs a shell command. Use this when asked to verify, check, or list files.

CRITICAL — write_file content is RAW CODE only, never JSON:
  WRONG: write_file(content='{\"code\": \"...\"}')
  CORRECT: write_file(content=\"function ClickMe() { return <button>Click</button>; }\")

CODE RULES: No import statements. No export keyword. Tailwind for styling.

IMPORTANT WORKFLOW:
When asked to UPDATE an existing file, you MUST first read_file to see the current code,
then explain what you will change, then write_file the updated version.";

    // Clean work dir and pre-seed a fresh file so the model has something to read
    let _ = tokio::fs::remove_dir_all(work_dir).await;
    let _ = tokio::fs::create_dir_all(work_dir).await;
    let seed_content = r#"function ClickMe() {
  return (
    <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors">
      Click Me
    </button>
  );
}"#;
    let _ = tokio::fs::write(work_dir.join("output.tsx"), seed_content).await;

    let user_prompt = "Read the file output.tsx using read_file, then add a hover scale effect (scale-105) to the button and change the label to 'Submit'. Write the updated code to output.tsx using write_file.";

    let separator = "═".repeat(70);
    println!("\n{separator}");
    println!("[{label}] Test — Cursor chat flow (thinking → read → text → write → final)");
    println!("{separator}");
    println!("  Model: {model}  |  Thinking: {}", think_level.display());
    println!("  Work dir: {}", work_dir.display());
    println!();

    let result = match run_cursor_chat_loop(
        ollama, model, system_prompt, user_prompt, work_dir, think_level,
    ).await {
        Ok(result) => result,
        Err(err) => {
            println!("  ❌ FATAL: {err}");
            fail("agent loop executed without fatal error");
            return;
        }
    };

    // ── Print every event in order (the Cursor experience) ──
    println!("\n  ── Event stream (Cursor IDE view) ──\n");
    for event in &result.events {
        log_event(event);
    }
    println!();

    // ── Verify the event sequence ──

    let event_types: Vec<&str> = result.events.iter().map(|e| e.label()).collect();
    println!("  ── Event sequence: {:?} ──\n", event_types);

    check("at least one Chunk event", result.events.iter().any(|e| matches!(e, CompletionEvent::Chunk { .. })));
    check("at least one ToolCall event", result.events.iter().any(|e| matches!(e, CompletionEvent::ToolCall { .. })));
    check("at least one ToolResult event", result.events.iter().any(|e| matches!(e, CompletionEvent::ToolResult { .. })));
    check("Done event present", result.events.iter().any(|e| matches!(e, CompletionEvent::Done)));
    check("no Error events", !result.events.iter().any(|e| matches!(e, CompletionEvent::Error { .. })));

    // ── Verify the Cursor flow specifically ──

    // The model MUST call read_file first, then later write_file
    let read_file_index = result.tool_calls_made.iter().position(|name| name == "read_file");
    let write_file_index = result.tool_calls_made.iter().position(|name| name == "write_file");

    check("read_file was called", read_file_index.is_some());
    check("write_file was called", write_file_index.is_some());

    if let (Some(read_idx), Some(write_idx)) = (read_file_index, write_file_index) {
        check("read_file called BEFORE write_file", read_idx < write_idx);
    }

    // After read_file tool result, there should be text before write_file
    // This simulates the Cursor "explaining what it will do" between tool calls
    let has_text_between_tools = {
        let read_result_idx = result.events.iter().position(|e|
            matches!(e, CompletionEvent::ToolResult { tool, .. } if tool == "read_file")
        );
        let write_call_idx = result.events.iter().position(|e|
            matches!(e, CompletionEvent::ToolCall { tool, .. } if tool == "write_file")
        );
        if let (Some(read_result_idx), Some(write_call_idx)) = (read_result_idx, write_call_idx) {
            let events_between = &result.events[read_result_idx + 1..write_call_idx];
            events_between.iter().any(|e| matches!(e, CompletionEvent::Chunk { text, .. } if !text.is_empty()))
        } else {
            false
        }
    };
    check("text between read_file result and write_file call (Cursor explains changes)", has_text_between_tools);

    // ── Verify tool execution results ──

    check("file was written to disk", result.file_written);
    if let Some(ref path) = result.written_path {
        check("written file exists on disk", path.exists());
    } else {
        fail("written file path captured");
    }

    if let Some(ref content) = result.written_content {
        check("written content > 50 chars", content.len() > 50);
        check("written content is React code", content.contains("function") || content.contains("const") || content.contains("return"));
        // Check that the model actually made the requested changes
        check("content updated with 'Submit' label", content.contains("Submit"));
        check("content updated with scale effect", content.contains("scale"));
    } else {
        fail("written content captured");
    }

    // ── Verify text was accumulated (the conversational replies) ──

    let combined_text = result.text_chunks_collected.concat();
    check("model produced conversational text", combined_text.len() > 10);

    // ── Verify thinking (if enabled) ──

    if matches!(think_level, ThinkLevel::Bool | ThinkLevel::Medium) {
        check("thinking chunks received", !result.thinking_chunks_collected.is_empty());
    }

    // ── Verify loop terminated properly ──

    check("loop ended without hitting MAX_ITERATIONS", result.iterations < MAX_ITERATIONS);

    println!();
}

// ─── Test 2: Simple single-tool call (baseline) ─────────────────────────────

async fn test_single_tool_call(
    ollama: &Ollama,
    model: &str,
    work_dir: &Path,
    label: &str,
) {
    EVENT_COUNTER.store(1, Ordering::Relaxed);

    // Clean work dir for a fresh test
    let _ = tokio::fs::remove_dir_all(work_dir).await;
    let _ = tokio::fs::create_dir_all(work_dir).await;

    let system_prompt = "You are a helpful assistant. You MUST use the provided tools. Never output code in plain text — always use write_file.";
    let user_prompt = "Create a simple React function App that renders 'Hello World'. Save it using write_file.";

    let separator = "═".repeat(70);
    println!("\n{separator}");
    println!("[{label}] Test — Single tool call (write_file only)");
    println!("{separator}\n");

    let result = run_cursor_chat_loop(ollama, model, system_prompt, user_prompt, work_dir, ThinkLevel::None).await;

    match result {
        Ok(agent_result) => {
            for event in &agent_result.events {
                log_event(event);
            }
            println!();
            check("write_file tool was called", agent_result.tool_calls_made.iter().any(|name| name == "write_file"));
            check("file was written", agent_result.file_written);
            check("Done event present", agent_result.events.iter().any(|e| matches!(e, CompletionEvent::Done)));
        }
        Err(err) => {
            fail("agent loop executed");
            println!("  Error: {err}");
        }
    }
    println!();
}

// ─── Ollama client builder ──────────────────────────────────────────────────

fn build_ollama(host: &str, api_key: &str) -> Ollama {
    let (scheme, rest) = if let Some(stripped) = host.strip_prefix("https://") {
        ("https", stripped)
    } else if let Some(stripped) = host.strip_prefix("http://") {
        ("http", stripped)
    } else {
        ("http", host)
    };
    let (base, port) = if let Some(colon_pos) = rest.rfind(':') {
        if let Ok(port_num) = rest[colon_pos + 1..].parse::<u16>() {
            (format!("{scheme}://{}", &rest[..colon_pos]), port_num)
        } else {
            (format!("{scheme}://{rest}"), if scheme == "https" { 443 } else { 11434 })
        }
    } else {
        (format!("{scheme}://{rest}"), if scheme == "https" { 443 } else { 11434 })
    };

    if !api_key.is_empty() {
        use ollama_rs::headers::{HeaderMap, AUTHORIZATION};
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, format!("Bearer {api_key}").parse().unwrap());
        Ollama::new_with_request_headers(base, port, headers)
    } else {
        Ollama::new(base, port)
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    let run_local = args.contains(&"--local".to_string());
    let run_cloud = args.contains(&"--cloud".to_string());

    // Parse --model flag: defaults to gemma4-26b-128k:latest for local, minimax-m2.7 for cloud
    let model_override = args.windows(2)
        .find(|w| w[0] == "--model")
        .map(|w| w[1].clone());

    if !run_local && !run_cloud {
        eprintln!("Usage: cargo run --bin test_cursor_chat -- [--local] [--cloud <host> <api_key>] [--model <model>]");
        eprintln!();
        eprintln!("  --local              Run against local Ollama (default: gemma4-26b-128k:latest)");
        eprintln!("  --cloud <h> <k>      Run against cloud Ollama endpoint with host and API key");
        eprintln!("  --model <name>       Override the model name (e.g. --model gpt-oss:20b)");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  cargo run --bin test_cursor_chat -- --local");
        eprintln!("  cargo run --bin test_cursor_chat -- --local --model gpt-oss:20b");
        eprintln!("  cargo run --bin test_cursor_chat -- --cloud https://ollama.com <key> --model minimax-m2.7");
        std::process::exit(1);
    }

    let work_dir = std::env::temp_dir().join("prototyper_cursor_chat_test");
    let _ = tokio::fs::create_dir_all(&work_dir).await;
    println!("Work dir: {}", work_dir.display());

    if run_local {
        let default_local_model = "gemma4-26b-128k:latest";
        let model = model_override.as_deref().unwrap_or(default_local_model);
        let ollama = build_ollama("http://localhost:11434", "");

        let is_gpt_oss = model.starts_with("gpt-oss");
        let think_level = if is_gpt_oss { ThinkLevel::Medium } else { ThinkLevel::Bool };
        println!("\n  Model: {model}  |  GPT-OSS: {is_gpt_oss}  |  Thinking: {}", think_level.display());

        // Test 1: Simple single-tool call baseline (no thinking)
        let dir1 = work_dir.join("01_single");
        test_single_tool_call(&ollama, model, &dir1, "local-single").await;
        sleep(Duration::from_secs(5)).await;

        // Test 2: Full Cursor chat flow WITHOUT thinking
        let dir2 = work_dir.join("02_no_think");
        test_cursor_chat_flow(&ollama, model, &dir2, ThinkLevel::None, "local-no-think").await;
        sleep(Duration::from_secs(5)).await;

        // Test 3: Full Cursor chat flow WITH thinking (model-appropriate level)
        let dir3 = work_dir.join("03_think");
        test_cursor_chat_flow(&ollama, model, &dir3, think_level, "local-think").await;
    }

    if run_cloud {
        let cloud_idx = args.iter().position(|arg| arg == "--cloud").unwrap();
        let cloud_host = args.get(cloud_idx + 1).map(String::as_str).unwrap_or("https://ollama.com");
        let cloud_key = args.get(cloud_idx + 2).map(String::as_str).unwrap_or("");
        let default_cloud_model = "minimax-m2.7";
        let model = model_override.as_deref().unwrap_or(default_cloud_model);

        if run_local {
            println!("\n[5s cool-off before cloud tests]");
            sleep(Duration::from_secs(5)).await;
        }

        let ollama = build_ollama(cloud_host, cloud_key);

        let dir4 = work_dir.join("04_cloud_single");
        test_single_tool_call(&ollama, model, &dir4, "cloud-single").await;
        sleep(Duration::from_secs(5)).await;

        let dir5 = work_dir.join("05_cloud_no_think");
        test_cursor_chat_flow(&ollama, model, &dir5, ThinkLevel::None, "cloud-no-think").await;
        sleep(Duration::from_secs(5)).await;

        let dir6 = work_dir.join("06_cloud_think");
        test_cursor_chat_flow(&ollama, model, &dir6, ThinkLevel::Bool, "cloud-think").await;
    }

    let failures = TOTAL_FAILURES.load(Ordering::Relaxed);
    println!("\n══════════════════════════════════════");
    if failures == 0 {
        println!("  ALL CHECKS PASSED ✓");
    } else {
        println!("  {failures} CHECK(S) FAILED ✗");
    }
    println!("══════════════════════════════════════\n");

    if failures > 0 {
        std::process::exit(1);
    }
}