# Plan: Integrate ollama-rs for Ollama API Communication

## Context

The current Ollama integration in `src-tauri/src/lib.rs` is hand-rolled with `reqwest` — manual JSON construction, manual NDJSON stream parsing, manual thinking chunk detection. This is fragile. The goal is to replace it with [`ollama-rs`](https://github.com/pepperoni21/ollama-rs) to get reliable streaming, native thinking support, image upload, and tool calling so the AI writes generated files via a tool call instead of us regex-parsing code out of markdown text.

OpenAI and Claude providers are **out of scope** — their backend code is a separate integration and stays untouched.

---

## Critical Files

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | Add ollama-rs dependency |
| `src-tauri/src/lib.rs` | Replace Ollama reqwest code with ollama-rs; add `WriteFileTool`; update `CompletionEvent` |
| `src/lib/ipc.ts` | Add `FileWritten` event variant; add `outputPath` param |
| `src/hooks/useChat.ts` | Handle `FileWritten` event; add `outputPath` option |
| `src/panels/ScreensPanel.tsx` | Pass `outputPath` to `useChat` |
| `src/panels/ComponentsPanel.tsx` | Pass `outputPath` to `useChat` |
| `src/panels/ThemesPanel.tsx` | Pass `outputPath` to `useChat` |

---

## Step 1 — Cargo.toml

Add to `[dependencies]`:

```toml
ollama-rs = { version = "0.3.4", features = ["stream", "macros"] }
```

Check if `base64` is already present; add if missing:
```toml
base64 = "0.22"
```

---

## Step 2 — lib.rs: Update `CompletionEvent`

Add a new variant so the frontend knows when the AI has written a file via tool:

```rust
#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
enum CompletionEvent {
    Chunk { text: String, thinking: Option<String> },
    FileWritten { path: String, content: String },
    Done,
    Error { message: String },
}
```

---

## Step 3 — lib.rs: `WriteFileTool` struct

Because `#[ollama_rs::function]` generates standalone async fns and cannot close over shared state, implement the `Tool` trait directly:

```rust
struct WriteFileTool {
    output_path: PathBuf,
    captured: Arc<Mutex<Option<String>>>,
}
```

Implement the `Tool` trait (verify exact method signatures from `ollama-rs` source):
- `name()` → `"write_file"`
- `description()` → `"Write the generated code or CSS to the output file. Always call this tool with the complete file content."`
- `parameters()` → JSON Schema: `{ content: { type: "string" } }`
- `call(&self, params)` → extract `params["content"]`, store in `self.captured`, return `Ok("File written.")`

The Rust side does **not** write to disk here — the content is captured and emitted as `CompletionEvent::FileWritten`, and the frontend (which already manages file writes via `write_file` IPC) applies it.

---

## Step 4 — lib.rs: Replace Ollama branch in `generate_completion_stream`

Update command signature to add optional params:

```rust
async fn generate_completion_stream(
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: Option<String>,
    think: Option<bool>,
    output_path: Option<String>,   // signals tool mode
    channel: Channel<CompletionEvent>,
) -> Result<(), String>
```

**Ollama branch logic** (when `detect_provider(model) == "ollama"`):

```
1. Parse host into base URL + port for Ollama::new()
2. If api_key is Some: configure Bearer token header
3. Convert Vec<Message> → Vec<ChatMessage>:
   - For each message with images[]: attach Image::from_base64(img) to the ChatMessage
4. Build ChatMessageRequest { model, messages }
5. If think == Some(true): set request options with think = true
6. Branch on output_path:

   A. output_path is Some(path):
      - Create captured: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None))
      - Build WriteFileTool { output_path, captured: Arc::clone(&captured) }
      - Build Coordinator::new(ollama, model, history)
          .add_tool(write_file_tool)
      - coordinator.chat(messages).await?
        → As coordinator emits partial text chunks, forward as CompletionEvent::Chunk
      - After coordinator resolves:
        → If captured.lock().unwrap().is_some():
           emit CompletionEvent::FileWritten { path, content }

   B. output_path is None (plain streaming, no tool):
      - ollama.send_chat_messages_stream(request).await?
      - while let Some(Ok(res)) = stream.next().await:
          emit CompletionEvent::Chunk {
            text: res.message.content,
            thinking: res.message.thinking,  // Some(_) when think=true
          }

7. emit CompletionEvent::Done
```

**Update `list_ollama_models`**: Use `ollama.list_local_models().await?` from ollama-rs instead of manual reqwest GET. Keep `/api/show` calls for capability detection (or use `ollama.show_model_info()` if available in 0.3.4 — verify against source).

---

## Step 5 — ipc.ts: Update types and wrapper

```typescript
// Add to CompletionEvent union:
| { event: "FileWritten"; data: { path: string; content: string } }

// Add outputPath param:
export function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string | null,
  think: boolean | null,
  outputPath: string | null,
  channel: Channel<CompletionEvent>,
): Promise<void>
```

---

## Step 6 — useChat.ts: Handle FileWritten + outputPath

Add `outputPath?: string` to `UseChatOptions`.

In the channel `onmessage` handler, add:

```typescript
if (msg.event === "FileWritten") {
  options.onOutput?.(msg.data.content);
  toolWritten = true;
}
```

On `Done`: if `toolWritten === true`, skip the normal `onOutput(accumulatedContent)` call — the tool already delivered the file content cleanly, no `extractCode()` needed.

Thread `outputPath` through to `generateCompletionStream()` call.

---

## Step 7 — Panel updates

**ScreensPanel.tsx** — pass outputPath, simplify onOutput:
```typescript
useChat({
  outputPath: `${screensDir}/${screenId}/screen.tsx`,
  onOutput: (content) => {
    setPreviewCode(content);
    writeFile(screenPath, content);
  },
})
```

**ComponentsPanel.tsx** — same pattern with component path.

**ThemesPanel.tsx** — pass outputPath for `.css` file; `onOutput` receives clean CSS directly.

All panels always pass `outputPath`. Remove `extractCode()` and `stripThinking()` entirely from panel `onOutput` callbacks — the tool delivers clean content directly. Delete all dead code.

---

## Verification

1. `cargo build` in `src-tauri/` — no compile errors
2. `bunx tsc --noEmit` — no TypeScript errors
3. Run `bun run tauri:dev`:
   - Open Screens panel, select a local Ollama model (e.g., `qwen2.5-coder:7b`)
   - Send a generation prompt → `FileWritten` event fires, preview updates without code extraction
   - Enable thinking toggle → thinking content appears in Reasoning component during stream
   - Attach an image → vision model (e.g., `llava`) receives and processes it
   - Plain chat (no output file) → streaming still works without tool
