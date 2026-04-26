# Ollama API Research

_Local testing performed 2026-04-26 against Ollama on CachyOS (Wayland)._

## Available Models

| Model | Size | Quantization |
|-------|------|-------------|
| gemma4-26b-128k:latest | 17 GB | — |
| gemma4:26b | 17 GB | — |
| glm-4.7-flash-128k:latest | 19 GB | — |
| glm-4.7-flash:q4_K_M | 19 GB | q4_K_M |

---

## Tool Calling

### Test 1: Non-streaming with tool schema (gemma4)

```json
// Request: tools provided, stream: false
{
  "model": "gemma4-26b-128k:latest",
  "messages": [
    {"role": "system", "content": "Use the write_file tool to create files."},
    {"role": "user", "content": "Create a simple text file called hello.txt with content: Hello World"}
  ],
  "tools": [{ "type": "function", "function": { "name": "write_file", ... } }],
  "stream": false
}
```

**Result:**
```json
{
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [{
      "id": "call_f82kukum",
      "function": {
        "name": "write_file",
        "arguments": { "content": "Hello World", "path": "hello.txt" }
      }
    }]
  },
  "done": true,
  "done_reason": "stop"
}
```

**Key finding:** `content` is empty string `""`. The model returns structured `tool_calls` only — no text echo of tool syntax.

### Test 2: Streaming with tool schema (gemma4)

```json
// Request: tools provided, stream: true
```

**Streaming chunks observed:**
1. Thinking chunks: `content: ""`, `thinking: "The user wants..."` — all thinking, no content
2. Tool call chunk: `content: ""`, `tool_calls: [{...}]` — content STILL empty
3. Final chunk: `content: ""`, `done: true`

**Key finding:** Every chunk has `content: ""` during the tool-calling turn. No text echo of tool call syntax.

### Test 3: Second turn (tool result → confirmation text)

```json
// Messages include: user → assistant (with tool_calls) → tool ("File written successfully.")
```

**Result:** Clean text chunks: "The file `hello.txt` has been successfully created with the content \"Hello World\"." — readable confirmation, no raw syntax.

### Test 4: No tool schema — system prompt mentions tool (FM3 scenario)

```json
// Request: NO tools in schema, but system prompt says "use write_file tool"
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant. Use the write_file tool by calling write_file(content=\"...\")."},
    {"role": "user", "content": "Create a text file called hello.txt"}
  ],
  "stream": false
}
```

**Result (gemma4):** `content: ""`, `thinking: "..."` — model thinks but outputs nothing. It's confused: system prompt says use a tool, but no tool schema exists.

**Result (glm-4.7-flash):** Raw code in content — model falls back to outputting code directly, ignoring the tool instruction.

### Test 5: No tool schema, no tool mention in prompt

```json
// Request: NO tools, system prompt says "output the full file content directly"
```

**Result (gemma4):** Content with code in markdown fences — normal plain-mode behavior.

---

## Content + Tool Calls Relationship

**Critical Ollama behavior:** `content` and `tool_calls` are NOT mutually exclusive in a single response chunk. Both can appear. However:

- **gemma4-26b-128k**: Always sends `content: ""` alongside `tool_calls`. No text echo.
- **glm-4.7-flash-128k**: Same — `content: ""` when `tool_calls` present.
- **Other models may differ.** Models trained on v0/screenshot-to-code data may include text content alongside tool calls.

The Rust backend (lib.rs line 587-589) forwards ALL `content` as `Chunk` events:
```rust
let text = response.message.content;
if thinking.is_some() || !text.is_empty() {
    let _ = channel.send(CompletionEvent::Chunk { text, thinking });
}
```
This is correct — if `content` is empty (as with gemma4), no `Chunk` is sent during tool turns. If a model does echo text, it'll flow through as a `Chunk`, and the frontend's `(!outputPath || toolWritten)` suppression guard handles it.

---

## JSON Envelope Bug

### What the user saw

Models trained on v0/screenshot-to-code datasets sometimes wrap the entire `write_file` content parameter in a JSON envelope:

```json
{
  "commentary": "I created a compact admin panel...",
  "title": "Admin Panel",
  "description": "A compact admin dashboard...",
  "additional_dependencies": [],
  "has_additional_dependencies": false,
  "install_dependencies_command": "",
  "port": 3000,
  "file_path": "pages/index.tsx",
  "code": "import React, { useState } from 'react';\n..."
}
```

The actual TSX code is buried inside the `"code"` key. This JSON object gets written to disk as `component.tsx` — causing a syntax error.

### Reproducibility

**Could NOT reproduce with locally available models:**

| Model | Tool Schema | Prompt | Result |
|-------|-------------|--------|--------|
| gemma4-26b-128k | ✅ provided | Current (NEVER OUTPUT...) | ✅ Raw code |
| gemma4-26b-128k | ✅ provided | Enhanced anti-JSON | ✅ Raw code |
| gemma4-26b-128k | ❌ none | Any | ❌ Planning text or fenced code |
| glm-4.7-flash-128k | ✅ provided | Current | ✅ Raw code |
| glm-4.7-flash-128k | ❌ none | Any | ✅ Raw code (no JSON) |

The JSON envelope likely manifests with:
- Cloud models (Ollama Cloud, OpenAI, Anthropic)
- Models specifically fine-tuned on v0/screenshot-to-code datasets
- Models with strong instruction-following that interpret "describe your component" as structured metadata

### Mitigation approach

Instead of parsing/hacking responses, we:
1. **Strengthen prompts** — show the exact JSON envelope pattern as WRONG with concrete examples
2. **Update tool description** — explicitly state "raw code, NOT a JSON object"
3. **Don't fight the model** — if a model really wants to output JSON, prompt engineering alone won't fix it. The fix belongs at the model/finetuning level.

We intentionally rejected:
- ~~JSON envelope unwrapping in `extractCode`~~ — fragile, masks the real problem
- ~~`unwrapJsonEnvelope` in `useChat.ts` onOutput~~ — same issue
- ~~"Output ONLY the tool call — text response must be completely empty"~~ — models are bad at producing nothing, and it's unnecessarily restrictive across diverse models

---

## Streaming Behavior Summary

### With tool schema (tool mode)

```
Turn 1 (tool call):
  Chunk { thinking: "..." }          ← thinking chunks (if enabled)
  Chunk { text: "" }                  ← empty content in every chunk
  tool_calls: [{ name: "write_file", arguments: { content: "...", path: "..." } }]

[Backend processes tool call, sends FileWritten event]

Turn 2 (confirmation):
  Chunk { text: "The file has been..." }  ← normal text
  Done
```

### Without tool schema (plain mode)

```
Single turn:
  Chunk { text: "```tsx\nfunction App()..." }   ← code in markdown fences
  OR
  Chunk { text: "Planning text..." }             ← confused output
  Done
```

---

## Key Takeaways

1. **Tool calling works reliably** with gemma4 and glm-4.7 through Ollama. The structured `tool_calls` response is correct, and `content` is empty during tool turns.

2. **The `content` + `tool_calls` coexistence** in chunks means the frontend must suppress text content before `FileWritten` fires. The `(!outputPath || toolWritten)` guard in `useChat.ts` handles this correctly.

3. **FM3 (no tool schema)** is the worst case — model has no way to invoke tools, so it falls back to text output. This should be avoided by always providing the tool schema when `outputPath` is set.

4. **JSON envelopes are model-specific**, not Ollama-specific. We cannot fix them with response parsing — prompt engineering is the best defense, and it works for most models.

5. **"Completely empty text response" is a bad instruction.** Models don't reliably produce zero text. Let the model write a description — the tool call's `content` parameter is what matters for code, not the text response.