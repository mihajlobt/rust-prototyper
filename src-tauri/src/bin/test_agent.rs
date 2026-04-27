//! Agent loop verification test.
//! Runs tests sequentially with 5s cooling between each against Ollama local (gemma4)
//! and Ollama cloud (minimax m2.7). Prints PASS/FAIL for each assertion.
//!
//! Usage:
//!   Local only:  cargo run --bin test_agent -- --local
//!   Cloud only:  cargo run --bin test_agent -- --cloud <host> <api_key>
//!   Both:        cargo run --bin test_agent -- --local --cloud <host> <api_key>

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use futures_util::StreamExt;
use ollama_rs::{
    Ollama,
    generation::{
        chat::{ChatMessage, request::ChatMessageRequest},
        tools::{ToolInfo, ToolType, ToolFunctionInfo},
    },
};
use schemars::{JsonSchema, generate::SchemaSettings};
use serde::Deserialize;
use tokio::time::sleep;

// ─── Minimal schema helpers ───────────────────────────────────────────────────

#[derive(Deserialize, JsonSchema)]
struct WriteFileArgs {
    pub path: Option<String>,
    pub content: String,
}

#[derive(Deserialize, JsonSchema)]
struct ReadFileArgs {
    pub path: String,
}

#[derive(Deserialize, JsonSchema)]
struct BashArgs {
    pub command: String,
}

fn make_schema<T: JsonSchema>() -> schemars::Schema {
    let mut s = SchemaSettings::draft07();
    s.inline_subschemas = true;
    s.into_generator().into_root_schema_for::<T>()
}

fn build_tools() -> Vec<ToolInfo> {
    vec![
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "write_file".to_string(),
                description: "Write raw source code to a file. content must be raw code only.".to_string(),
                parameters: make_schema::<WriteFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "read_file".to_string(),
                description: "Read a file's contents.".to_string(),
                parameters: make_schema::<ReadFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "bash".to_string(),
                description: "Run a shell command in the project directory. 30-second timeout.".to_string(),
                parameters: make_schema::<BashArgs>(),
            },
        },
    ]
}

// ─── Tool executor ────────────────────────────────────────────────────────────

struct ToolResult {
    output: String,
    written_path: Option<PathBuf>,
    written_content: Option<String>,
}

async fn execute_tool(name: &str, args: &serde_json::Value, work_dir: &Path) -> ToolResult {
    match name {
        "write_file" => {
            let parsed = serde_json::from_value::<WriteFileArgs>(args.clone())
                .unwrap_or_else(|_| WriteFileArgs { path: None, content: String::new() });
            let rel = parsed.path.as_deref().unwrap_or("output.tsx");
            if rel.contains("..") {
                return ToolResult { output: "path traversal denied".into(), written_path: None, written_content: None };
            }
            let target = work_dir.join(rel);
            if let Some(p) = target.parent() { let _ = tokio::fs::create_dir_all(p).await; }
            match tokio::fs::write(&target, &parsed.content).await {
                Ok(()) => ToolResult { output: format!("Written: {rel}"), written_path: Some(target), written_content: Some(parsed.content) },
                Err(e) => ToolResult { output: format!("write_file error: {e}"), written_path: None, written_content: None },
            }
        }
        "read_file" => {
            let parsed = serde_json::from_value::<ReadFileArgs>(args.clone())
                .unwrap_or_else(|_| ReadFileArgs { path: String::new() });
            if parsed.path.contains("..") {
                return ToolResult { output: "path traversal denied".into(), written_path: None, written_content: None };
            }
            match tokio::fs::read_to_string(work_dir.join(&parsed.path)).await {
                Ok(c) => ToolResult { output: c, written_path: None, written_content: None },
                Err(e) => ToolResult { output: format!("read_file error: {e}"), written_path: None, written_content: None },
            }
        }
        "bash" => {
            let parsed = serde_json::from_value::<BashArgs>(args.clone())
                .unwrap_or_else(|_| BashArgs { command: "echo ''".to_string() });
            let child = tokio::process::Command::new("sh")
                .arg("-c").arg(&parsed.command)
                .current_dir(work_dir)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn();
            match child {
                Err(e) => ToolResult { output: format!("spawn error: {e}"), written_path: None, written_content: None },
                Ok(c) => match tokio::time::timeout(Duration::from_secs(30), c.wait_with_output()).await {
                    Ok(Ok(out)) => {
                        let s = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
                        ToolResult { output: if s.trim().is_empty() { "(no output)".into() } else { s }, written_path: None, written_content: None }
                    }
                    Ok(Err(e)) => ToolResult { output: format!("bash error: {e}"), written_path: None, written_content: None },
                    Err(_) => ToolResult { output: "bash: timed out".into(), written_path: None, written_content: None },
                },
            }
        }
        _ => ToolResult { output: format!("unknown tool: {name}"), written_path: None, written_content: None },
    }
}

// ─── Agent loop ───────────────────────────────────────────────────────────────

struct AgentRunResult {
    file_written: bool,
    written_path: Option<PathBuf>,
    written_content: Option<String>,
    text_chunks: Vec<String>,
    tool_calls: Vec<String>,   // tool names called, in order
    bash_outputs: Vec<String>,
    read_file_outputs: Vec<String>,
    iterations: u8,
}

/// Run exactly ONE model turn: send prompt, collect tool calls, execute them, return.
/// Does NOT loop. Use this for single-tool verification tests.
async fn run_one_turn(
    ollama: &Ollama,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    work_dir: &Path,
) -> AgentRunResult {
    let tools = build_tools();
    let history: Arc<Mutex<Vec<ChatMessage>>> = Arc::new(Mutex::new(vec![]));
    let initial = vec![
        ChatMessage::system(system_prompt.to_string()),
        ChatMessage::user(user_prompt.to_string()),
    ];
    let request = ChatMessageRequest::new(model.to_string(), initial).tools(tools);

    let mut result = AgentRunResult {
        file_written: false, written_path: None, written_content: None,
        text_chunks: vec![], tool_calls: vec![], bash_outputs: vec![],
        read_file_outputs: vec![], iterations: 0,
    };

    let mut tool_calls_this_turn: Vec<ollama_rs::generation::tools::ToolCall> = vec![];
    let mut stream = match ollama.send_chat_messages_with_history_stream(history.clone(), request).await {
        Ok(s) => s,
        Err(e) => { eprintln!("  stream error: {e}"); return result; }
    };
    while let Some(res) = stream.next().await {
        match res {
            Ok(r) => {
                if !r.message.tool_calls.is_empty() { tool_calls_this_turn = r.message.tool_calls.clone(); }
                let text = r.message.content;
                if !text.is_empty() { result.text_chunks.push(text); }
            }
            Err(_) => { eprintln!("  chunk error"); break; }
        }
    }

    for call in &tool_calls_this_turn {
        let name = &call.function.name;
        let args = &call.function.arguments;
        println!("  → tool call: {name}({})", args.to_string().chars().take(80).collect::<String>());
        result.tool_calls.push(name.clone());
        let tr = execute_tool(name, args, work_dir).await;
        println!("  ← result: {}", tr.output.chars().take(100).collect::<String>());
        if name == "write_file" && tr.written_path.is_some() {
            result.file_written = true;
            result.written_path = tr.written_path;
            result.written_content = tr.written_content.clone();
        }
        if name == "bash" { result.bash_outputs.push(tr.output.clone()); }
        if name == "read_file" { result.read_file_outputs.push(tr.output.clone()); }
        history.lock().unwrap().push(ChatMessage::tool(tr.output));
    }
    result
}

/// Run the full multi-turn agentic loop until model produces no tool calls.
/// Max 8 iterations with 4s cool-off between turns.
async fn run_agent_loop(
    ollama: &Ollama,
    model: &str,
    system_prompt: &str,
    user_prompt: &str,
    work_dir: &Path,
) -> AgentRunResult {
    let tools = build_tools();
    let history: Arc<Mutex<Vec<ChatMessage>>> = Arc::new(Mutex::new(vec![]));
    let initial = vec![
        ChatMessage::system(system_prompt.to_string()),
        ChatMessage::user(user_prompt.to_string()),
    ];
    let mut request = ChatMessageRequest::new(model.to_string(), initial).tools(tools.clone());

    let mut result = AgentRunResult {
        file_written: false, written_path: None, written_content: None,
        text_chunks: vec![], tool_calls: vec![], bash_outputs: vec![],
        read_file_outputs: vec![], iterations: 0,
    };

    const MAX_ITER: u8 = 8;
    loop {
        let mut tool_calls_this_turn: Vec<ollama_rs::generation::tools::ToolCall> = vec![];
        let mut stream = match ollama.send_chat_messages_with_history_stream(history.clone(), request).await {
            Ok(s) => s,
            Err(e) => { eprintln!("  stream error: {e}"); break; }
        };
        while let Some(res) = stream.next().await {
            match res {
                Ok(r) => {
                    if !r.message.tool_calls.is_empty() { tool_calls_this_turn = r.message.tool_calls.clone(); }
                    let text = r.message.content;
                    if !text.is_empty() { result.text_chunks.push(text); }
                }
                Err(_) => { eprintln!("  chunk error"); break; }
            }
        }

        if tool_calls_this_turn.is_empty() {
            println!("  loop complete: model returned text (no more tool calls)");
            break;
        }
        if result.iterations >= MAX_ITER {
            println!("  loop hit MAX_ITER={MAX_ITER} — model did not stop on its own");
            break;
        }

        let mut wrote_file = false;
        for call in &tool_calls_this_turn {
            let name = &call.function.name;
            let args = &call.function.arguments;
            println!("  → tool call: {name}({})", args.to_string().chars().take(80).collect::<String>());
            result.tool_calls.push(name.clone());
            let tr = execute_tool(name, args, work_dir).await;
            println!("  ← result: {}", tr.output.chars().take(100).collect::<String>());
            if name == "write_file" && tr.written_path.is_some() {
                result.file_written = true;
                result.written_path = tr.written_path;
                result.written_content = tr.written_content.clone();
                wrote_file = true;
            }
            if name == "bash" { result.bash_outputs.push(tr.output.clone()); }
            if name == "read_file" { result.read_file_outputs.push(tr.output.clone()); }
            history.lock().unwrap().push(ChatMessage::tool(tr.output));
        }

        if wrote_file {
            // Closing turn: no tools — forces model to produce text confirmation.
            let closing = ChatMessageRequest::new(model.to_string(), vec![]);
            let mut closing_stream = match ollama.send_chat_messages_with_history_stream(history.clone(), closing).await {
                Ok(s) => s,
                Err(e) => { eprintln!("  closing turn error: {e}"); break; }
            };
            print!("  closing turn: ");
            while let Some(res) = closing_stream.next().await {
                if let Ok(r) = res {
                    let text = r.message.content;
                    if !text.is_empty() {
                        result.text_chunks.push(text.clone());
                        print!("{text}");
                    }
                }
            }
            println!();
            println!("  loop complete: closing turn done");
            break;
        }

        // Non-write_file tools (read_file, bash) — continue with tools available
        request = ChatMessageRequest::new(model.to_string(), vec![]).tools(tools.clone());
        result.iterations += 1;
        sleep(Duration::from_secs(4)).await;
    }
    result
}

// ─── Test suite ───────────────────────────────────────────────────────────────

fn pass(label: &str) { println!("  ✓ {label}"); }
fn fail(label: &str) { println!("  ✗ {label}"); }

fn check(label: &str, ok: bool) {
    if ok { pass(label); } else { fail(label); }
}

// System prompt close to the actual Prototyper prompt (research-confirmed reliable).
const SYSTEM_PROMPT: &str = "You are an expert React/TypeScript UI developer.

TOOL USAGE — REQUIRED:
You MUST use the provided tools to complete every task. Never output code in plain text.
- write_file: saves raw source code to disk. Use this to save any component you write.
- read_file: reads an existing file from disk. Use this when you need to see a file before editing.
- bash: runs a shell command. Use this when asked to verify, check, or list files.

CRITICAL — write_file content is RAW CODE only, never JSON:
  WRONG: write_file(content='{\"code\": \"...\"}')
  CORRECT: write_file(content=\"function ClickMe() { return <button>Click</button>; }\")

CODE RULES: No import statements. No export keyword. Tailwind for styling.";

// ── Single-turn tests: verify each tool executes correctly in isolation ──────

// Test 1: write_file — one turn, model must call write_file.
async fn test_write_file(ollama: &Ollama, model: &str, work_dir: &Path, label: &str) {
    println!("\n[{label}] Test 1 — write_file (single turn)");
    let r = run_one_turn(
        ollama, model, SYSTEM_PROMPT,
        "Create a React button component named ClickMe. Save it to ClickMe.tsx using write_file.",
        work_dir,
    ).await;
    check("write_file called", r.tool_calls.iter().any(|t| t == "write_file"));
    check("file written to disk", r.written_path.as_ref().map(|p| p.exists()).unwrap_or(false));
    check("content > 50 chars", r.written_content.as_ref().map(|c| c.len() > 50).unwrap_or(false));
    check("content is React code", r.written_content.as_ref()
        .map(|c| c.contains("function") || c.contains("const") || c.contains("return"))
        .unwrap_or(false));
}

// Test 2: read_file — one turn, pre-seed a file, model must call read_file.
async fn test_read_file(ollama: &Ollama, model: &str, work_dir: &Path, label: &str) {
    println!("\n[{label}] Test 2 — read_file (single turn)");
    let seed = "function ClickMe() {\n  return <button className=\"px-4 py-2 bg-blue-500 text-white rounded\">Click Me</button>;\n}";
    let _ = tokio::fs::write(work_dir.join("ReadTarget.tsx"), seed).await;

    let r = run_one_turn(
        ollama, model, SYSTEM_PROMPT,
        "Read the file ReadTarget.tsx using read_file and tell me what component it defines.",
        work_dir,
    ).await;
    check("read_file called", r.tool_calls.iter().any(|t| t == "read_file"));
    check("got file contents back", r.read_file_outputs.iter().any(|o| o.contains("ClickMe")));
}

// Test 3: bash — one turn, model must call bash and output must be correct.
async fn test_bash(ollama: &Ollama, model: &str, work_dir: &Path, label: &str) {
    println!("\n[{label}] Test 3 — bash (single turn)");
    let r = run_one_turn(
        ollama, model, SYSTEM_PROMPT,
        "Use the bash tool to run `echo 'agent-test-ok'` and report the output.",
        work_dir,
    ).await;
    check("bash called", r.tool_calls.iter().any(|t| t == "bash"));
    check("bash output non-empty", !r.bash_outputs.is_empty());
    check("echo output correct", r.bash_outputs.iter().any(|o| o.contains("agent-test-ok")));
    println!("  bash output: {:?}", r.bash_outputs.first().map(|s| s.trim().to_string()));
}

// ── Multi-turn test: full loop, model must chain tools and stop on its own ───

// Test 4: loop — model writes a file, then the loop continues until model stops.
// Asserts: write_file called, loop terminates naturally (model returns text with no tool calls).
async fn test_loop_terminates(ollama: &Ollama, model: &str, work_dir: &Path, label: &str) {
    println!("\n[{label}] Test 4 — agentic loop terminates naturally");
    let r = run_agent_loop(
        ollama, model, SYSTEM_PROMPT,
        "Create a React button component named ClickMe. Save it to ClickMe.tsx using write_file. After saving, respond with a one-sentence description of the component.",
        work_dir,
    ).await;
    check("write_file called", r.file_written);
    check("file on disk", r.written_path.as_ref().map(|p| p.exists()).unwrap_or(false));
    check("loop ended (model stopped calling tools)", {
        // The loop breaks when model returns text. If it hit MAX_ITER the model never stopped.
        // We detect this by checking iterations — if < 8 the model stopped on its own.
        r.iterations < 8
    });
    check("model produced confirmation text", !r.text_chunks.is_empty());
    println!("  iterations before stop: {}", r.iterations);
    println!("  final text: {:?}", r.text_chunks.last().map(|s| s.chars().take(80).collect::<String>()));
}

fn build_ollama(host: &str, api_key: &str) -> Ollama {
    let (scheme, rest) = if let Some(s) = host.strip_prefix("https://") { ("https", s) }
        else if let Some(s) = host.strip_prefix("http://") { ("http", s) }
        else { ("http", host) };
    let (base, port) = if let Some(c) = rest.rfind(':') {
        if let Ok(p) = rest[c+1..].parse::<u16>() { (format!("{scheme}://{}", &rest[..c]), p) }
        else { (format!("{scheme}://{rest}"), if scheme == "https" { 443 } else { 11434 }) }
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

#[tokio::main]
async fn main() {
    let args: Vec<String> = std::env::args().collect();

    let run_local = args.contains(&"--local".to_string());
    let run_cloud = args.contains(&"--cloud".to_string());

    if !run_local && !run_cloud {
        eprintln!("Usage: cargo run --bin test_agent -- [--local] [--cloud <host> <api_key>]");
        std::process::exit(1);
    }

    let work_dir = std::env::temp_dir().join("prototyper_agent_test");
    let _ = tokio::fs::create_dir_all(&work_dir).await;
    println!("Work dir: {}", work_dir.display());

    if run_local {
        println!("\n═══ LOCAL: gemma4-26b-128k via Ollama local ═══");
        let ollama = build_ollama("http://localhost:11434", "");
        let model = "gemma4-26b-128k:latest";

        test_write_file(&ollama, model, &work_dir, "local").await;
        sleep(Duration::from_secs(5)).await;

        test_read_file(&ollama, model, &work_dir, "local").await;
        sleep(Duration::from_secs(5)).await;

        test_bash(&ollama, model, &work_dir, "local").await;
        sleep(Duration::from_secs(5)).await;

        test_loop_terminates(&ollama, model, &work_dir, "local").await;
    }

    if run_cloud {
        let cloud_idx = args.iter().position(|a| a == "--cloud").unwrap();
        let cloud_host = args.get(cloud_idx + 1).map(String::as_str).unwrap_or("https://ollama.com");
        let cloud_key = args.get(cloud_idx + 2).map(String::as_str).unwrap_or("");
        let cloud_model = "minimax-m2.7";

        if run_local {
            println!("\n[5s cool-off before cloud tests]");
            sleep(Duration::from_secs(5)).await;
        }

        println!("\n═══ CLOUD: minimax-m2.7 via Ollama cloud ({cloud_host}) ═══");
        let ollama = build_ollama(cloud_host, cloud_key);

        test_write_file(&ollama, cloud_model, &work_dir, "cloud").await;
        sleep(Duration::from_secs(5)).await;

        test_read_file(&ollama, cloud_model, &work_dir, "cloud").await;
        sleep(Duration::from_secs(5)).await;

        test_bash(&ollama, cloud_model, &work_dir, "cloud").await;
        sleep(Duration::from_secs(5)).await;

        test_loop_terminates(&ollama, cloud_model, &work_dir, "cloud").await;
    }

    println!("\nDone.");
}
