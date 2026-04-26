# Ollama API Research — Tool Calling for Prototyper

_Revised 2026-04-26. Incorporates official Ollama docs (docs.ollama.com), OpenAPI spec (fetched from https://docs.ollama.com/openapi.yaml), Context7-verified API schemas, ollama-rs 0.3.4 source, and 70+ controlled curl tests against gemma4-26b-128k._

---

## 1. Official Ollama Tool Calling API

### 1.1 Request Format

Per the [Ollama OpenAPI spec](https://docs.ollama.com/openapi.yaml) and [tool calling docs](https://docs.ollama.com/capabilities/tool-calling):

```json
POST /api/chat
{
  "model": "qwen3",
  "messages": [
    {"role": "system", "content": "Use the write_file tool to save code."},
    {"role": "user", "content": "Create a button component"}
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "write_file",
        "description": "Write the raw source code to the output file.",
        "parameters": {
          "type": "object",
          "required": ["content"],
          "properties": {
            "content": {
              "type": "string",
              "description": "The complete file content to write"
            }
          }
        }
      }
    }
  ],
  "stream": true,
  "think": true
}
```

### 1.2 Response Format (Tool Call)

```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "thinking": "The user wants me to create a button...",
    "tool_calls": [
      {
        "function": {
          "name": "write_file",
          "arguments": { "content": "function App() { return <button>Click Me</button>; }" }
        }
      }
    ]
  }
}
```

**Key behavior:**
- `content` is `""` (empty string) during the tool-calling turn — the model puts code in `tool_calls[].function.arguments`, NOT in `content`
- `thinking` may be present if `think` is enabled
- Multiple tool calls can appear in a single response (parallel tool calling)

### 1.3 Tool Result Message Format

The official docs' tutorial examples show:
```json
{"role": "tool", "tool_name": "write_file", "content": "File written successfully."}
```

However, the **OpenAPI spec** (fetched 2026-04-26 from https://docs.ollama.com/openapi.yaml) `ChatMessage` schema only defines:
```yaml
ChatMessage:
  type: object
  required: [role, content]
  properties:
    role: { type: string, enum: [system, user, assistant, tool] }
    content: { type: string }
    images: { type: array, items: { type: string } }
    tool_calls: { type: array, items: { $ref: '#/components/schemas/ToolCall' } }
```

Context7-verified API docs (`/websites/ollama_api`) confirm the same schema — `ChatMessage` has `role`, `content`, `images`, `tool_calls` only. **No `tool_name` field.**

**The `tool_name` field is NOT in the OpenAPI schema.** This creates a discrepancy:
- Tutorial docs use `"tool_name"` 
- The OpenAPI spec doesn't define it
- Ollama's Go server likely accepts it as an extra field (OpenAPI `additionalProperties` defaults to `true` for object types, and the spec doesn't set `additionalProperties: false`)
- The ollama-rs `Coordinator` (which is the library's own agent loop implementation, see §4.4) uses `ChatMessage::tool(resp)` — no `tool_name`

**Our current Rust backend** creates tool result messages via `ollama-rs` `ChatMessage::tool(content)` which produces `{ role: "tool", content: "..." }` — no `tool_name`. This matches the OpenAPI schema, the ollama-rs library's own Coordinator pattern, and appears to work in practice.

### 1.4 Agent Loop Pattern

The official docs recommend a `while True` loop:

```
while True:
  response = chat(model, messages, tools, think=True)
  messages.append(response.message)
  
  if response.message.tool_calls:
    for call in response.message.tool_calls:
      result = execute_tool(call)
      messages.append({role: "tool", tool_name: call.function.name, content: result})
  else:
    break  # No more tool calls — done
```

**Our current implementation** does a fixed two-turn pattern: tool call → confirm. This works for our single-tool use case but won't handle models that want to call `write_file` multiple times or want to reason and re-call after seeing results.

### 1.5 Streaming with Tool Calls

Per the official docs, when streaming with tool calls:

1. Accumulate `thinking`, `content`, and `tool_calls` from each chunk
2. Pass them all back together in the follow-up request as `{'role': 'assistant', 'thinking': thinking, 'content': content, 'tool_calls': tool_calls}`
3. Then append tool result messages

**Our current Rust backend** relies on `ollama-rs`'s `send_chat_messages_with_history_stream`, which auto-manages the assistant message in history. However, it may not pass `thinking` and `tool_calls` back into the history correctly — the library's history management pushes `ChatMessage::assistant(result)` (content only), not the full message with thinking and tool_calls fields.

### 1.6 Parallel Tool Calling

The Ollama docs show models can return **multiple tool calls** in a single response:
```json
{
  "tool_calls": [
    {"function": {"name": "get_temperature", "arguments": {"city": "New York"}}},
    {"function": {"name": "get_temperature", "arguments": {"city": "London"}}},
    {"function": {"name": "get_conditions", "arguments": {"city": "New York"}}},
    {"function": {"name": "get_conditions", "arguments": {"city": "London"}}}
  ]
}
```

**Our current backend** only has one tool (`write_file`), so parallel calls would be multiple `write_file` invocations. The code does iterate over all `last_tool_calls` (line 596), so it could handle multiple `write_file` calls — but it writes them all to `output_path` (a single path), which means only the last write survives.

---

## 2. Test Results (gemma4-26b-128k)

70+ individual curl requests, one at a time, no parallelism.

### 2.1 System Prompt is the Dominant Factor

| System Prompt | Thinking | Tool Call Rate | JSON Envelopes |
|---|---|---|---|
| None | Off | 4/10 (40%) | 0 |
| None | On | 3/10 (30%) | 0 |
| "Use the write_file tool to save code." | Off | **10/10 (100%)** | 0 |
| "Use the write_file tool to save code." | On | **10/10 (100%)** | 0 |
| "You MUST call write_file" | Off | **10/10 (100%)** | 0 |
| "You MUST call write_file" | On | **10/10 (100%)** | 0 |
| Full Prototyper prompt | On | **10/10 (100%)** | 0 |

**Conclusion:** Any mention of `write_file` in the system prompt gives 100% tool call rate. Without it, the model defaults to text output 60-70% of the time.

### 2.2 Thinking Mode is Safe

With a system prompt, thinking mode has **zero impact** on reliability (100% with or without). Without a system prompt, thinking slightly *decreases* tool call probability (the model "thinks" its way to a text explanation).

### 2.3 Zero JSON Envelopes Locally

Across all 70+ requests, gemma4-26b-128k produced **zero** `{"commentary":"...", "code":"..."}` JSON envelopes. The JSON envelope pattern seen by the user likely comes from cloud models or v0-finetuned models.

### 2.4 Content is Always Empty During Tool Calls

In non-streaming mode, when the model calls `write_file`, `message.content` is always `""`. In streaming mode, every chunk has `content: ""` during the tool-calling turn. No text echo.

---

## 3. Current Prototyper Implementation Analysis

### 3.1 Rust Backend (`src-tauri/src/lib.rs`)

**Tool schema definition** (lines 509-543):
- `WriteFileParams` has single `content: String` field
- Tool description says "raw code — NOT a JSON object, NOT wrapped in an envelope"
- `write_file_tool_info()` generates the JSON Schema via schemars

**Streaming flow** (lines 546-655):
```
Turn 1 (tool call):
  → send_chat_messages_with_history_stream(history, request)
  → Accumulate tool_calls, forward thinking/content chunks
  → After stream ends, execute write_file for each tool call
  → Push ChatMessage::tool("File written successfully.") to history

Turn 2 (confirmation):
  → send_chat_messages_with_history_stream(history, confirm_request)
  → Forward content chunks as confirmation text
```

**Identified issues:**

| Issue | Severity | Description |
|---|---|---|
| ollama-rs history doesn't preserve thinking/tool_calls | **Medium** | `send_chat_messages_with_history_stream` pushes `ChatMessage::assistant(result)` (content only) to history. The follow-up request loses the `thinking` and `tool_calls` fields from the assistant's first-turn message. Per official docs, these should be passed back. |
| Two-turn pattern, not agent loop | **Low** | Current code does exactly two turns. If a model wants to call the tool again or make corrections, it can't. An agent loop would be more robust. |
| Multiple write_file calls overwrite | **Low** | If the model calls `write_file` multiple times in one response, each call sends a `FileWritten` event, but they all write to the same `output_path`. The last write wins. |
| `think` parameter limited | **Low** | We pass `ThinkType::True` but the API now supports `"high"`, `"medium"`, `"low"` string values. Not critical but suboptimal. |

### 3.2 Frontend (`src/hooks/useChat.ts`)

**Content suppression** (lines 182, 293):
- `sendMessage`: `msg.data.text && (!outputPath || toolWritten)` — suppresses text before `FileWritten`
- `regenerate`: `msg.data.text && (!outputPath || toolWrittenRegen)` — same guard

**This is correct.** During the tool-calling turn, `content` is empty for gemma4, but for models that echo text, this guard prevents it from displaying.

**FileWritten handling** (lines 191-199, 300-306):
- Sets `toolWritten = true`, clears `contentAccumulated`
- Calls `onOutputRef.current?.(stripFences(msg.data.content))`
- Calls `attachToolCall(entityId, "write_file", msg.data.path)`

**Done handling** (line 202, 319):
- `if (!toolWritten) onOutputRef.current?.(contentAccumulated)` — fallback for non-tool mode

**This is correct.** The flow properly handles both tool mode and plain text mode.

### 3.3 Prompts (`src/lib/prompts.ts`)

All 5 prompt bases now include:
- "TOOL USAGE — REQUIRED: You MUST call the write_file tool"
- "CRITICAL — THE content PARAMETER IS RAW CODE, NOT JSON" with WRONG/CORRECT examples
- "The content parameter is WRITTEN TO DISK as-is. JSON will cause a syntax error."

**This is working per test results.** The anti-JSON examples are a defense against v0-finetuned models even though we couldn't reproduce the issue locally.

---

## 4. ollama-rs Library Quirks

### 4.1 `ChatMessage::tool()` Constructor

```rust
// ollama-rs 0.3.4, src/generation/chat/mod.rs line 284
pub fn tool(content: String) -> Self {
    Self::new(MessageRole::Tool, content)
}
```

Creates `{ role: Tool, content: "..." }` — no `tool_name`. This matches the OpenAPI spec but **differs from the tutorial docs** which show `{"role": "tool", "tool_name": "write_file", "content": "..."}`.

**Impact:** Ollama servers likely accept both formats. The `tool_name` field may be used by the model to match tool results to the original call, especially for parallel tool calling. For our single-tool case, omitting `tool_name` appears to work fine.

### 4.2 History Management in Streaming Mode

```rust
// ollama-rs 0.3.4, send_chat_messages_with_history_stream, line 180-182
if item.done {
    item.message.content = result.clone();
    history.lock().unwrap().push(ChatMessage::assistant(result.clone()));
    result.clear();
}
```

**Problem:** This pushes a `ChatMessage::assistant(content_only)` to history, losing `thinking` and `tool_calls`. When the model receives the history for turn 2, it sees the assistant as having only said `""` (since content was empty during tool calls). The official docs recommend passing back the full accumulated message including `thinking` and `tool_calls`.

**Impact for Prototyper:** The second turn (confirmation) still works because the model has the tool result and can infer what happened. But this is technically incorrect per the Ollama docs and could cause issues with models that rely on seeing their own thinking/tool_calls in history.

### 4.3 No Direct `tool_name` Support

The `ChatMessage` struct has no `tool_name` field:
```rust
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub images: Option<Vec<Image>>,
    pub thinking: Option<String>,
}
```

If we need to send `tool_name` per the tutorial docs, we'd need to manually construct the JSON or extend the library. However, the ollama-rs `Coordinator` (see §4.4) also doesn't send `tool_name`, which validates our current approach.

### 4.4 Coordinator — Built-in Agent Loop (NEW DISCOVERY)

ollama-rs 0.3.4 includes a `Coordinator` struct (`src/coordinator.rs`) that implements the **exact agent loop pattern** described in the official Ollama docs:

```rust
// ollama-rs 0.3.4, src/coordinator.rs (simplified)
pub async fn chat(&mut self, messages: Vec<ChatMessage>) -> Result<ChatMessageResponse> {
    let resp = self.ollama.send_chat_messages_with_history(&mut self.history, request).await?;
    
    if !resp.message.tool_calls.is_empty() {
        for call in resp.message.tool_calls {
            let resp = tool.call(call.function.arguments).await?;
            self.history.push(ChatMessage::tool(resp));
        }
        // recurse — continue the agent loop
        Box::pin(self.chat(vec![])).await
    } else {
        Ok(resp)
    }
}
```

**Key observations:**
- Uses `send_chat_messages_with_history` (non-streaming), NOT the streaming variant
- After executing tool calls, pushes `ChatMessage::tool(result)` and **recurses** with empty messages
- Breaks when no tool calls are present (the model just gives a text response)
- **No `tool_name`** in the tool result — same as our current approach
- Uses `ToolHolder` trait for dynamic tool dispatch (we don't need this — we have one static tool)

**Why we can't use Coordinator directly:**
1. It's non-streaming — Prototyper requires streaming for real-time feedback (thinking, content)
2. It doesn't emit `FileWritten` events or `Chunk` events over the Tauri Channel
3. It uses the non-streaming `send_chat_messages_with_history`, which correctly preserves all `ChatMessage` fields in history (no bug there)

**What we should borrow:** The recursive agent loop pattern (call → execute → push tool result → call again → break on no tool calls). We can adapt this pattern for our streaming use case, but need to work around the ollama-rs streaming history bug (§4.2).

---

## 5. Recommendations

### 5.1 Rust Backend Changes (Priority Order)

1. **Fix history to include thinking and tool_calls** — After the first turn, construct the assistant message with accumulated thinking, content, and tool_calls before pushing to history. This aligns with the official Ollama agent loop pattern.

2. **Add `tool_name` to tool result messages** — Construct the tool result as `{"role": "tool", "tool_name": "write_file", "content": "File written successfully."}` instead of relying on ollama-rs's bare `ChatMessage::tool()`. This aligns with the tutorial docs and helps models that need to match results to calls. Since `ChatMessage` doesn't have `tool_name`, we can manually `serde_json::json!` the message or add a custom serialize.

3. **Convert to agent loop pattern** — Replace the fixed two-turn pattern with a `while last_tool_calls.is_some()` loop that:
   - Streams the response
   - Executes any `write_file` tool calls
   - Pushes tool results
   - Continues the loop for another turn
   - Breaks when no tool calls are made

4. **Support `think` levels** — Accept `"high"`, `"medium"`, `"low"` string values in addition to boolean. Pass `ThinkType::from_str()` or custom enum.

### 5.2 Prompt Changes

Current prompts are working (100% tool call rate in testing). **No urgent changes needed.** However:

- The WRONG/CORRECT anti-JSON examples are good defensive measures — keep them
- The "You MUST call the write_file tool" instruction is the key reliability driver — keep it
- Consider adding a brief note that the model can describe what it built in its text response (after the tool call), since we now allow text in the confirmation turn

### 5.3 Frontend Changes

**No changes needed.** The content suppression guard, FileWritten handling, and Done handling are all correct.

---

## 6. Notable Observations from Official Docs

- **The `tool_name` discrepancy:** Tutorial docs use `"tool_name"` but the OpenAPI spec doesn't define it. This is likely because the OpenAPI spec was auto-generated from the Go structs and the `tool_name` field is handled as a dynamic/extra field. Ollama's Go code probably parses it from the JSON even though it's not in the formal schema.

- **The think parameter accepts strings:** The API now supports `"high"`, `"medium"`, `"low"` in addition to boolean. This is useful for controlling reasoning effort.

- **Tool definitions need `parameters` to be required:** The OpenAPI spec marks `parameters` as required in `ToolFunctionInfo`. Even if a tool takes no parameters, an empty `"parameters": {"type": "object"}` must be provided.

- **`keep_alive` parameter:** Can control model unloading. Not relevant for Prototyper (we want models loaded).

- **`logprobs` support:** Available but not used by Prototyper.

---

## 7. Appendix: ollama-rs 0.3.4 Source Paths

| File | Purpose |
|---|---|
| `~/.cargo/registry/src/.../ollama-rs-0.3.4/src/generation/chat/mod.rs` | `ChatMessage`, `ChatMessageResponse`, streaming/history methods |
| `~/.cargo/registry/src/.../ollama-rs-0.3.4/src/generation/chat/request.rs` | `ChatMessageRequest` builder |
| `~/.cargo/registry/src/.../ollama-rs-0.3.4/src/generation/tools/mod.rs` | `Tool`, `ToolInfo`, `ToolCall`, `ToolFunctionInfo` |
| `~/.cargo/registry/src/.../ollama-rs-0.3.4/src/coordinator.rs` | `Coordinator` — built-in agent loop with tool calling |
| `~/.cargo/registry/src/.../ollama-rs-0.3.4/examples/chat_with_history_stream.rs` | History streaming example |

## 8. Sources Consulted

| Source | Method | Date |
|---|---|---|
| https://docs.ollama.com/openapi.yaml | Direct fetch | 2026-04-26 |
| https://docs.ollama.com/capabilities/tool-calling | User-provided | 2026-04-26 |
| https://docs.ollama.com/api/chat | Direct fetch | 2026-04-26 |
| /websites/ollama_api (Context7) | API query — ChatMessage schema, tool calling | 2026-04-26 |
| /pepperoni21/ollama-rs (Context7) | API query — Coordinator, ChatHistory, tool calling | 2026-04-26 |
| ollama-rs 0.3.4 source (local cargo registry) | Direct read — ChatMessage, Coordinator, streaming | 2026-04-26 |
| 70+ curl tests against gemma4-26b-128k | Local testing | 2026-04-26 |