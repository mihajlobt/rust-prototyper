---
title: Open Agent SDK Analysis — Prototyper Integration Feasibility
layout: default
permalink: /architecture/open-agent-sdk-analysis/
---

# Open Agent SDK Analysis — Prototyper Integration Feasibility

> **Version audited:** `open-agent-sdk` v0.6.4 (commit `6b48021`)
> **Clone:** `/tmp/open-agent-sdk-rust-check`
> **Date:** 2026-04-30

---

## Executive Summary

**The `open-agent-sdk` cannot be used as a drop-in replacement for Prototyper's agent loop.** It is architecturally incompatible on four fundamental axes: API format (OpenAI SSE vs Ollama NDJSON), cancellation mechanism (`AtomicBool` vs `tokio_util::CancellationToken`), thinking support (**absent**), and frontend visibility during tool execution (**completely opaque in auto mode**).

However, several patterns are worth adopting: **hooks**, **retry logic**, and **tool builder pattern**.

**This document was originally written in response to a tool-card "running" state bug** (see [§3](#3-resolved-the-missing-running-state-bug) for what changed and how it was resolved).

---

## 1. Library Architecture

### 1.1 API Format Target

The library targets the **OpenAI-compatible `/v1/chat/completions` endpoint**. It does **NOT** speak the Ollama native `/api/chat` protocol.

**Evidence:**

```rust
let url = format!("{}/chat/completions", options.base_url());
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:1309`

It expects SSE (Server-Sent Events) with the OpenAI incremental delta format — `data: {...}\n\n` — not Ollama's newline-delimited JSON:

```text
# OpenAI SSE (library expects this)
data: {"id":"chatcmpl-123","object":"chat.completion.chunk",...}
data: [DONE]

# Ollama NDJSON (Prototyper uses this)
{"message":{"content":"H","role":"assistant"},"done":false}
{"message":{"content":"i","role":"assistant"},"done":false}
```

**Evidence — library SSE parser:**

```rust
pub fn parse_sse_stream(body: reqwest::Response) -> Pin<Box<dyn Stream<Item = Result<OpenAIChunk>> + Send>> {
    body.bytes_stream().filter_map(move |result| async move {
        let text = String::from_utf8_lossy(&bytes);
        for line in text.lines() {
            if let Some(data) = line.strip_prefix("data: ") {
                if data == "[DONE]" { continue; }
                let chunk: OpenAIChunk = serde_json::from_str(data)?;
                return Some(Ok(chunk));
            }
        }
    })
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/utils.rs:436–483`

### 1.2 Streaming Format: OpenAI Deltas

OpenAI delivers streaming content as **incremental deltas**. A single tool call may be split across dozens of SSE chunks:

```text
Chunk 1: { tool_calls: [{ index: 0, id: "call_abc123", function: { name: "get_weather" } }] }
Chunk 2: { tool_calls: [{ index: 0, function: { arguments: "{\"loc" } }] }
Chunk 3: { tool_calls: [{ index: 0, function: { arguments: "ation" } }] }
Chunk 4: { finish_reason: "tool_calls" }
```

The library solves this with a `ToolCallAggregator` that buffers and assembles partial tool calls.

**Evidence:**

```rust
pub fn process_chunk(&mut self, chunk: OpenAIChunk) -> Result<Vec<ContentBlock>> {
    // Phase 2: Accumulate tool call deltas
    if let Some(tool_calls) = choice.delta.tool_calls {
        for tool_call in tool_calls {
            let entry = self.tool_calls.entry(tool_call.index).or_default();
            if let Some(id) = tool_call.id { entry.id = Some(id); }
            if let Some(function) = tool_call.function {
                if let Some(name) = function.name { entry.name = Some(name); }
                if let Some(args) = function.arguments { entry.arguments.push_str(&args); }
            }
        }
    }
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/utils.rs:279–310`

**For Ollama, this aggregation is unnecessary.** Ollama delivers complete `tool_calls` as a JSON array on the `done=true` chunk alone. Prototyper's current architecture doesn't need a `ToolCallAggregator`.

### 1.3 Two Operating Modes

| Mode | Description | Frontend Visibility |
|------|-------------|---------------------|
| **Manual** | Caller receives `ToolUseBlock`, executes tool, calls `add_tool_result()`, then `send("")` | ✅ Full — every step is visible to the caller |
| **Auto** | Library internally collects ALL blocks, executes tools, loops, and only emits final text | ❌ **Nothing** — tool execution is completely hidden |

**Evidence — auto mode implementation:**

```rust
async fn auto_execute_loop(&mut self) -> Result<Vec<ContentBlock>> {
    loop {
        // STEP 1: Collect ALL blocks from current stream into memory
        let blocks = self.collect_all_blocks().await?;

        // STEP 2: Separate text from tool use
        let mut text_blocks = Vec::new();
        let mut tool_blocks = Vec::new();
        for block in blocks {
            match block {
                ContentBlock::Text(_) => text_blocks.push(block),
                ContentBlock::ToolUse(_) => tool_blocks.push(block),
                _ => {}
            }
        }

        // If no tool calls, return text
        if tool_blocks.is_empty() {
            return Ok(text_blocks);
        }

        // Execute tools, add results to history, continue loop
        for block in tool_blocks {
            if let ContentBlock::ToolUse(tool_use) = block {
                let result = self.execute_tool_internal(tool_use.name(), tool_input).await?;
                self.history.push(Message::tool(result));
            }
        }
        self.send("").await?; // Continue to next iteration
    }
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:1425–1676`

**Reference — `collect_all_blocks` explicitly buffers the entire response:**

```rust
async fn collect_all_blocks(&mut self) -> Result<Vec<ContentBlock>> {
    let mut blocks = Vec::new();
    while let Some(block) = self.receive_one().await? {
        blocks.push(block);
    }
    Ok(blocks)
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:1444–1461`

### 1.4 Client State

```rust
pub struct Client {
    options: AgentOptions,           // model, base_url, tools, hooks
    history: Vec<Message>,           // conversation history
    current_stream: Option<ContentStream>, // active SSE stream
    interrupted: Arc<AtomicBool>,    // cancellation flag
    auto_exec_buffer: Vec<ContentBlock>, // buffered blocks in auto mode
    auto_exec_index: usize,          // read position in auto_exec_buffer
    manual_receive_buffer: Vec<ContentBlock>, // blocks in manual mode
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:831–903`

**Cancellation uses `Arc<AtomicBool>`**, checked on every `receive_one()` call:

```rust
if self.interrupted.load(Ordering::SeqCst) {
    return Ok(None);
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:1398–1406`

This is less cooperative than Prototyper's `CancellationToken` + `tokio::select!` approach. The library's interrupt drops the next `receive_one()` call, but the underlying HTTP stream may continue running until the next chunk arrives.

### 1.5 Tool Builder Pattern

```rust
let add_tool = tool("add", "Add two numbers")
    .param("a", "number")
    .param("b", "number")
    .build(|args| async move {
        let a = args["a"].as_f64().unwrap_or(0.0);
        let b = args["b"].as_f64().unwrap_or(0.0);
        Ok(json!({"result": a + b}))
    });
```

**Reference:** `/tmp/open-agent-sdk-rust-check/examples/calculator_tools.rs:13–20`

### 1.6 Hooks System

Three hook types:

```rust
pub struct Hooks {
    pre_tool_use: Vec<PreToolUseHook>,      // Before executing tool
    post_tool_use: Vec<PostToolUseHook>,    // After tool result added to history
    user_prompt_submit: Vec<UserPromptSubmitHook>, // Before sending user prompt
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/hooks.rs`

Execution order: **sequential, first non-None decision wins** (short-circuit).

**Reference:** `/tmp/open-agent-sdk-rust-check/src/client.rs:1645–1658`

**Evidence — PreToolUse hook in production example:**

```rust
let hooks = Hooks::new()
    .add_pre_tool_use(|event: PreToolUseEvent| async move {
        if event.tool_name == "delete" || event.tool_name == "modify_system" {
            return Some(HookDecision::block("Safety policy violation"));
        }
        // Validation: division by zero
        if event.tool_name == "calculate" {
            if let Some(b) = event.tool_input.get("b").and_then(|v| v.as_f64()) {
                if b == 0.0 {
                    return Some(HookDecision::block("Division by zero prevented"));
                }
            }
        }
        Some(HookDecision::continue_())
    })
    .add_post_tool_use(|event: PostToolUseEvent| async move {
        // Audit logging + metadata injection
        log.lock().unwrap().push(format!("[{}] {} -> {}", ...));
        Some(HookDecision::modify_input(json!(enhanced), "Added metadata"))
    });
```

**Reference:** `/tmp/open-agent-sdk-rust-check/examples/multi_tool_agent.rs:142–206`

### 1.7 Context Management

Token estimation and manual truncation utilities are exposed as functions, not automatic behavior:

```rust
let tokens = estimate_tokens(client.history());
if is_approaching_limit(client.history(), token_limit, margin) {
    let truncated = truncate_messages(client.history(), 10, true);
    *client.history_mut() = truncated;
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/src/context.rs`

This is consistent with Prototyper's philosophy of manual history management, though we currently lack the token estimation helper.

---

## 2. Comparison: Library vs Prototyper

### 2.1 Feature Matrix

| Feature | Library | Prototyper | Fit |
|---------|---------|-----------|-----|
| **API format** | OpenAI SSE (`/v1/chat/completions`) | Ollama native (`/api/chat`) | ❌ Different formats |
| **Streaming text** | SSE `delta.content` incremental chunks | Ollama NDJSON `message.content` tokens | ⚠️ Both stream but format differs |
| **Thinking / reasoning** | **NOT SUPPORTED** — no `thinking` field | `thinking` streaming via rAF batching | ❌ Prototyper supports this |
| **Tool call aggregation** | `ToolCallAggregator` for incremental deltas | Captures complete `tool_calls` on `done=true` | ⚠️ Library pattern not needed for Ollama |
| **Tool execution visibility** | Manual: visible. **Auto: completely hidden** | **Always visible** via `ToolCall` → `ToolResult` → `Done` events | ❌ Auto mode is a dealbreaker |
| **Frontend IPC** | None (standalone HTTP client) | Tauri `Channel<CompletionEvent>` | ❌ Library has no Tauri integration |
| **Cancellation** | `Arc<AtomicBool>` + check on receive | `CancellationToken` + `tokio::select!` | ✅ Both work; Token is more idiomatic with Ollama |
| **Hooks** | PreToolUse, PostToolUse, UserPromptSubmit | None | ✅ Library has this |
| **Retry logic** | Exponential backoff with jitter | None | ✅ Library has this |
| **Context truncation** | `estimate_tokens()`, `truncate_messages()` | None | ✅ Library has this |
| **Vision/multimodal** | `ImageBlock` (URL, file, base64) | Not yet implemented | ✅ Library pattern could inspire |
| **Hooks** | Async closures with builder | None | ✅ Could adopt pattern |

### 2.2 Critical Incompatibility: Auto-Execution in a Desktop App

The library's most attractive feature is also its biggest problem for a desktop app.

In **auto-execution mode** (the mode you'd want for a simple user experience), the library:

1. Buffers the **entire assistant response** in memory
2. Separates text blocks from tool use blocks
3. Executes tools automatically
4. Continues the conversation internally
5. Only emits final text to the caller

During steps 1–4, the **frontend receives absolutely nothing**. No text tokens, no tool cards, no spinners, no progress indicators. A 30-second tool execution (e.g., a slow `bash` command) would appear as a frozen UI.

**Evidence:** The library itself acknowledges this in its example code:

```rust
// auto_execution_demo.rs:127–135
ContentBlock::ToolUse(_) => {
    // Should NOT receive ToolUse blocks in auto mode!
    println!("⚠️  Unexpected: Received ToolUse block");
}
ContentBlock::ToolResult(_) => {
    // Should NOT receive ToolResult blocks either!
    println!("⚠️  Unexpected: Received ToolResult block");
}
```

**Reference:** `/tmp/open-agent-sdk-rust-check/examples/auto_execution_demo.rs:127–135`

In a Cursor-like desktop app, **this is unacceptable**. The user must see:
- Every streaming text token as it arrives
- The moment a tool call is requested
- A "Processing..." spinner during tool execution
- The tool result when complete

Prototyper solves this via its event-driven architecture:
- `Chunk` → text appears live
- `ToolCall` → tool card appears with `pending: true`
- `ToolResult` → spinner transitions to complete
- `Done` → conversation finalizes

**Reference:** Prototyper `src-tauri/src/commands/ai.rs:36–43` (CompletionEvent enum)

---

## 3. Resolved: The Missing "Running" State Bug

Tool cards used to render straight to "Completed" without ever showing a "Processing" / `input-streaming` state. The shipped fix is the simplest one: `attachToolCall` / `resolveToolCall` write straight to the Zustand store as each Channel event arrives (`src/hooks/chat/streamHandler.ts:94–96,144`), and `tool.tsx` derives the rendered card state directly from `{ pending, success }`. Real tool execution (file I/O, shell commands) takes long enough that `ToolCall` and `ToolResult` essentially never land in the same JS task, so the "running" state renders correctly.

See [Chat Stream & Tool Flow → Tauri Channel Batching]({{ '/architecture/chat-flow/' | relative_url }}#tauri-channel-batching) for the verified current mechanism.

## 4. Recommendations

### 4.1 Reject: Full Library Replacement

| Dimension | Why Incompatible |
|-----------|-----------------|
| API format | OpenAI SSE ≠ Ollama NDJSON. We'd need a whole new parser (`parse_sse_stream` is OpenAI-only). |
| Thinking support | Library has no `thinking` field. Prototyper relies on this for reasoning display. |
| Tauri / IPC | Library has zero Tauri integration. We'd need a full bridge layer. |
| Frontend visibility | Auto mode hides tool execution. Manual mode is verbose and loses convenience. |
| Cancellation | `AtomicBool` drops next receive call. `CancellationToken` drops the HTTP connection itself. |
| History model | Library uses `Vec<Message>` with nested `ContentBlock` arrays. Prototyper uses flat `ChatMessage` with `toolCalls`. Translation required. |

### 4.2 Adopt: Hook Pattern

Create `src-tauri/src/agent/hooks.rs` with:

```rust
pub enum HookDecision {
    Continue,
    Block { reason: String },
    ModifyInput { input: serde_json::Value, reason: String },
}

pub struct Hooks {
    pre_tool_use: Vec<Box<dyn Fn(&PreToolUseEvent) -> BoxFuture<HookDecision>>>,
    post_tool_use: Vec<Box<dyn Fn(&PostToolUseEvent) -> BoxFuture<Option<serde_json::Value>>>>,
}
```

**Use cases for Prototyper:**
- **PreToolUse**: Validate file paths (path traversal guard), confirm destructive operations (bash commands), rate-limit tool calls
- **PostToolUse**: Audit log all tool executions, inject metadata into tool results, send telemetry

**Reference pattern:** `/tmp/open-agent-sdk-rust-check/src/hooks.rs`

### 4.3 Adopt: Retry Logic

Add exponential backoff to `generate_completion_stream` for transient HTTP failures (connection refused, timeout, 503).

```rust
use crate::retry::RetryConfig;

let result = RetryConfig::default()
    .max_attempts(3)
    .base_delay_ms(500)
    .with_jitter(true)
    .execute(|| async {
        // HTTP request
    }).await;
```

**Reference pattern:** `/tmp/open-agent-sdk-rust-check/src/retry.rs`

### 4.4 Adopt: Tool Builder Pattern

Replace JSON blobs in `src-tauri/src/agent/tools.rs` with a builder:

```rust
let write_file = Tool::new("write_file", "Write content to a file")
    .param("content", "string", "The file content to write")
    .build(|args| async move {
        let content = args["content"].as_str().unwrap_or("");
        tokio::fs::write(path, content).await?;
        Ok(json!({"success": true}))
    });
```

This doesn't change behavior but improves developer experience.

**Reference pattern:** `/tmp/open-agent-sdk-rust-check/src/tools.rs`

### 4.5 Adopt: Token Estimation

Add `estimate_tokens()` and `is_approaching_limit()` before sending to prevent context overflow.

```rust
let token_count = estimate_tokens(&history);
if token_count > MAX_CONTEXT_TOKENS * 0.9 {
    history = truncate_messages(&history, 10, true);
}
```

**Reference pattern:** `/tmp/open-agent-sdk-rust-check/src/context.rs`

### 4.6 Resolved: The Missing "Running" State Bug

This was the original trigger for this analysis. The shipped fix was simpler than any option considered here: stop deferring at all. `attachToolCall` / `resolveToolCall` write straight to the Zustand store as each Channel event arrives, and `tool.tsx` renders directly off `{ pending, success }`. See [§3](#3-resolved-the-missing-running-state-bug).

## 5. Exact Source References

### Prototyper Code

| File | Line Range | Role |
|------|-----------|------|
| `src/hooks/useChat.ts` | 23–75 | `buildApiMessages()` — Ollama tool history |
| `src/hooks/chat/streamHandler.ts` | 53–71 | `finalize()` — persists final message, writes `chat.json` |
| `src/hooks/chat/streamHandler.ts` | 73–177 | `channel.onmessage` handlers (Chunk, ToolCall, ToolResult, Done) |
| `src/stores/chatStore.ts` | 77–86 | `attachToolCall()` — pushes `{ pending: true }` |
| `src/stores/chatStore.ts` | 88–105 | `resolveToolCall()` — mutates matching entry to `{ pending: false, success }` |
| `src/components/ui/tool.tsx` | 15–27 | `ToolPart` state union + state derivation from `{ pending, success }` |
| `src/components/ui/tool.tsx` | 171–187 | `input-streaming` / `output-available` / `output-error` rendering |
| `src-tauri/src/agent/agent_loop.rs` | 47–55,169–172 | manual history fix — preserves `tool_calls` on the assistant message |
| `src-tauri/src/agent/agent_loop.rs` | 170–189 | Tool execution + `ToolCall` / `ToolResult` event send |
| `src-tauri/src/agent/agent_loop.rs` | 191–200 | `wrote_file = true` → break + `Done` |
| `src-tauri/src/commands/ai.rs` | 461–550 | `generate_completion_stream` — tokio::spawn, CancellationToken |
| `src-tauri/src/commands/ai.rs` | 36–43 | `CompletionEvent` enum definitions |
| `node_modules/@tauri-apps/api/core.js` | 99–105 | `while-loop` transformCallback batching |

### Open Agent SDK

| File | Line Range | Role |
|------|-----------|------|
| `src/client.rs` | 831–903 | `Client` struct definition |
| `src/client.rs` | 905–1375 | `Client::send()` — builds request, runs hooks, stores stream |
| `src/client.rs` | 1377–1423 | `receive_one()` — core streaming logic |
| `src/client.rs` | 1425–1461 | `collect_all_blocks()` — buffers entire response |
| `src/client.rs` | 1499–1676 | `auto_execute_loop()` — auto-execution loop |
| `src/utils.rs` | 150–352 | `ToolCallAggregator` — incremental tool call assembly |
| `src/utils.rs` | 436–483 | `parse_sse_stream()` — OpenAI SSE parsing |
| `src/hooks.rs` | Full file | `Hooks`, `HookDecision`, hook execution |
| `src/types.rs` | Full file | `AgentOptions`, `ContentBlock`, `Message`, OpenAI types |
| `src/retry.rs` | Full file | Exponential backoff with jitter |
| `src/context.rs` | Full file | Token estimation, context truncation |
| `examples/multi_tool_agent.rs` | 142–206 | Production agent with hooks + 5 tools |
| `examples/auto_execution_demo.rs` | 127–135 | Acknowledges tool blocks hidden in auto mode |
| `examples/interrupt_demo.rs` | 146–179 | Concurrent interrupt with `Arc<AtomicBool>` |
| `Cargo.toml` | 31–32 | Dependencies: `reqwest`, `tokio` |