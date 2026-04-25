# Prototyper — Living Log

> Living document. Updated as work progresses. Read alongside git history.

---

## What Was Built

### Foundation
- **Tauri v2 desktop app** — React 19 + TypeScript frontend, Rust backend
- **7 panels**: Screens, Components, Themes, APIs, Runner, Library, Workflows
- **Streaming chat** in Screens, Components, Themes — multi-turn, with persistent history per entity
- **Allotment split-pane layouts** — persisted via `useAllotmentLayout` hook (sizes survive panel switches)
- **PromptInspector** — shows full message history and model config per panel
- **Drag-to-chat** — drag files from Runner file tree into chat as @mentions

### Ollama Integration (Rust — ollama-rs)
Replaced hand-rolled `reqwest` HTTP calls with [`ollama-rs`](https://github.com/pepperoni21/ollama-rs).

**What changed:**
- `to_ollama_messages()` uses `ChatMessage::user/assistant/system()` + `.with_images()` constructors
- `generate_ollama_completion_stream` — single function, same streaming path for both tool and non-tool mode (via `send_chat_messages_stream`)
- Tool mode uses `write_file_tool_info()` to pass the tool schema — a manual replication of `ToolInfo::new` (which is `pub(crate)`) using `SchemaSettings::draft07()` + schemars
- Non-tool calls use standard streaming without tool definitions
- `list_ollama_models` uses `ollama.list_local_models()` from ollama-rs
- `/api/show` capability detection still uses reqwest directly (for `family`, `families`, `context_length` fields not exposed in `LocalModel`)

**Thinking:**
- `thinking?: string` is a separate field on `ChatMessage` (TS) — not embedded as `<think>` XML tags
- Stored in history and sent back to Ollama per API spec (thinking field in messages is part of the schema)
- During streaming: `thinkingContent` in Zustand store, updated via rAF batching
- `Reasoning` component auto-opens when streaming starts, closes when done
- For tool mode: thinking arrives from the single `send_chat_messages` turn (same response as the tool call), streamed in real-time now

**Images:**
- `Message.images: Vec<String>` (base64) → `ChatMessage::user().with_images()`
- Frontend: `AttachmentFile` with base64, drag-drop, paste, file picker

### Tool-Based File Generation
Instead of parsing code blocks from text responses, the AI calls `write_file(content=...)` directly.

**Flow:**
1. `useChat` passes `outputPath` to `generateCompletionStream`
2. Rust builds `ChatMessageRequest` with `write_file_tool_info()` in `.tools([...])`
3. Model streams thinking + calls `write_file` tool
4. Tool call arguments deserialized into `WriteFileParams` via `serde_json::from_value`
5. `CompletionEvent::FileWritten { path, content }` emitted
6. Frontend `useChat` strips fences from content (`stripFences()`), calls `onOutput(cleanContent)`
7. Panel's `onOutput` updates editor state and writes to disk

**Panels that use tool mode:**
- `ScreensPanel` → writes `projects/{id}/screens/{screenId}/screen.tsx`
- `ComponentsPanel` → writes `projects/{id}/components/{compId}/component.tsx` + `generated/src/components/Generated.tsx`
- `ThemesPanel` → writes `projects/{id}/themes/{themeDir}/theme.css`

### Chat UX
- **Streaming markdown** — safe during stream (single `ReactMarkdown` pass, skips `marked.lexer` block-split to avoid unclosed fence crashes)
- **Code blocks** — `CodeBlockHeader` with language badge + copy button; language detection via `pre` override (not fragile position heuristic)
- **Tool call chips** — "📄 Wrote filename" badge in assistant messages after `FileWritten`
- **Regenerate** — strips last assistant message, replays last user message
- **Stop button** — red square while streaming; `stopRef` flag aborts channel processing immediately
- **Thinking section** — `ReasoningContent` via `Reasoning` component; initialized open on mount if streaming (avoids one-frame flash)
- **Chat input** — flat layout, no nested wrappers; Brain toggle shows "Thinking" label when active; image attach; stop/send swap

### UI Refactors
- ComponentsPanel: theme chooser moved from chat header → preview header; `AddLibraryModal` removed from chat, moved to Runner toolbar; Clear → `Trash2` icon with Tauri `confirm()` dialog
- Frame `key={selectedTheme}` forces iframe remount on theme change (CSS vars fully reload)
- ComponentsPanel dark mode: `.dark { color-scheme: dark }` + explicit `background: var(--background)` to match ThemesPanel behavior
- Code/CSS editors auto-open (`componentsCodeOpen`, `themesCodeOpen`) when new content is generated
- ThemesPanel `persistTheme` called in `onOutput` so generated CSS is saved to disk immediately

---

## What Was Fixed (Recent)

| Issue | Fix |
|-------|-----|
| `<think>` XML tags sent in history confusing model | `thinking` stored as separate `ChatMessage` field, mapped to `OllamaChatMessage.thinking` in Rust |
| Thinking broken on subsequent messages | Tags were baked into `content` — now a clean field; Ollama API sends `thinking` field in history per docs |
| Reasoning not visible during streaming | `Reasoning` initialized with `useState(() => isStreaming === true)`; `ReasoningContent` uses `useEffect` + `ResizeObserver` for max-height instead of stale JSX read |
| Tool mode (Coordinator) never showed thinking | Replaced Coordinator with direct `send_chat_messages_stream` + manual tool_call extraction; thinking now streams in real-time from the same turn |
| `isInline` code detection was broken for single-line fenced blocks | Replaced position heuristic with `pre` override — all block code routes through `<pre><code>`, inline code only reaches `code` renderer |
| Shiki crash on `"plaintext"` language | Remapped to `"text"`, added try/catch fallback |
| `allow(dead_code)` suppressions | Fixed root causes: `WriteFileParams.content` now deserialized via `serde_json::from_value::<WriteFileParams>` |
| Model wraps `write_file` content in fences | `stripFences()` applied to `FileWritten` content before `onOutput` |
| Library substitution without consultation | Added rule to `CLAUDE.md` |
| Dead `chat-utils.ts`, `prompt-input.tsx` | Deleted |

---

## Known Issues / Needs Fixing

### High Priority

**Tool calling reliability**
- Models (especially smaller local ones) don't always call `write_file` on the first message — they sometimes return code as text in the response content
- When the tool isn't called, `onOutput` is not called (no `FileWritten` event, `toolWritten` stays false, `Done` skips `onOutput` if `outputPath` is set)
- Result: no preview update, no code editor update, user sees only the explanation text
- Fix needed: if `outputPath` is set but no tool call arrived by `Done`, fall back to extracting code from `contentAccumulated` via `extractCode()` and calling `onOutput` with it

**Thinking in Components first message**
- On first send (empty history), thinking sometimes doesn't appear — likely the model doesn't generate thinking when deciding to call a tool on first turn
- Subsequent messages reliably show thinking (history context helps)
- May be model-specific behavior for qwen3/gemma4

**Function naming**
- Some models name the function `Sidebar`, `Card`, `NavItem` etc. instead of `App`
- Preview handles this via `declaredNames` fallback scan, but the entry component must be the LAST declared function or the first capitalized one — could fail for multi-component outputs where `App` calls inner components
- If model defines `NavItem`, `Sidebar`, `App` in that order: `NavItem` renders, not `App`
- Fix: scan for `App` specifically first, then fallback; or instruct model more clearly

**CSS theme in Component preview**
- `parentCss` is a snapshot of parent document CSS at render time
- If the parent app's active theme changes after the Frame is rendered, the iframe is stale until `selectedTheme` changes (triggers `key` remount)
- `getParentCss()` should probably be called inside the Frame's `head` computation to always reflect current state

### Medium Priority

**No streaming indicator during Coordinator wait**
- Tool mode now uses streaming, but some models respond very slowly before the tool call
- User sees empty typing loader for extended periods with no feedback
- Consider: show "Thinking…" or elapsed time indicator

**ThemesPanel `onOutput` saves without prompt metadata**
- `persistTheme(content, "")` is called with empty prompt string `""`
- `prompt.json` gets saved with `prompt: ""` — loses the prompt that generated the theme
- Fix: pass the last user message content as the prompt

**`useComponentCode` query not invalidated for new components**
- When a new component is created via AI (no prior saved component), `selectedComponent` is null, so `applyCode` skips the query invalidation
- Fix: after `applyCode`, if `selectedComponent` is now set (e.g., via SaveComponentModal), invalidate

**Messages with `thinking` field in history sent to non-thinking models**
- If user switches from a thinking model to a non-thinking model mid-conversation, history includes `thinking` fields
- Non-thinking models receiving `thinking` in history may behave unexpectedly
- Fix: strip `thinking` from history when sending to non-thinking models (check `caps.thinking`)

---

## Prompt System — State & Needed Improvements

### Current State
All three panel types (Screens, Components, Themes) use `write_file` tool mode with system prompts that:
- Specify `TOOL USAGE — REQUIRED` with WRONG/CORRECT examples
- List pre-loaded globals (React hooks, lucide icons)
- Forbid imports, exports, hardcoded colors
- Show "three-backtick" instead of literal fences (template literal constraint)
- CSS tool prompt includes no-fence example for CSS output

### What Still Fails with Local Models

#### gemma4 27b
- [x] ~~Code fences in output~~ (mitigated by `stripFences()` in useChat)
- [ ] Sometimes ignores `write_file` entirely — writes code in response text
- [ ] Named functions: uses semantic names (`Sidebar`, `NavItem`) instead of `App` wrapper
- [ ] Occasionally adds `import React from 'react'` or broken imports like `from 'lar'`
- [ ] Produces multi-component files without an `App` entry point

#### qwen3 / qwen2.5-coder
- [x] Thinking works (native thinking model)
- [ ] Sometimes skips `write_file` on first turn, uses it on regenerate
- [ ] Produces very verbose thinking that may slow responses

#### minimax-m2.7 and similar
- [x] ~~JSON envelope~~ (mitigated by `stripFences()` partially)
- [ ] Returns Vercel v0-style JSON `{"code": "...", "commentary": "..."}` — not handled by `stripFences` since it's JSON, not fenced code
- [ ] Full-page layouts despite component size constraint

### Prompt Improvements Needed

**1. Enforce App as the entry component more explicitly**
```
The LAST function in your code must be named App and must render the component.
Helper components (Button, Card, etc.) can have semantic names but App must call them.
Example structure:
  function NavItem({ ... }) { ... }
  function App() { return <NavItem /> }  ← must be last, must be named App
```

**2. Handle JSON-envelope models**
Models trained on Vercel v0 / similar datasets return JSON by default. Currently `stripFences` doesn't handle this. Need a JSON-content extractor:
- Check if `FileWritten` content starts with `{` → try to parse as JSON → extract `code` or `tsx` field
- Apply after `stripFences`

**3. Smaller models need explicit tool call syntax**
Some models don't understand the tool schema format. May need to show the exact JSON tool call format in the prompt for models that respond better to explicit examples:
```json
{"type": "function", "name": "write_file", "arguments": {"content": "function App() {...}"}}
```

**4. Prevent multi-component files without App wrapper**
Add to CODE RULES:
```
If you define helper components, App MUST be the final function and MUST render them.
A file with only function Sidebar() and no function App() will not render.
```

**5. Theme prompts: separate dark/light variable sets**
Current theme prompts don't enforce that `.dark {}` variables must be the inverse of `:root {}`.
Models sometimes generate `.dark {}` with the same lightness as `:root {}`.
Add explicit constraint: dark mode variables must use inverted lightness values.

**6. Model-specific prompt variants**
Consider exposing prompt templates per model family in Settings:
- Thinking models (qwen3): can include chain-of-thought instructions
- Small models (gemma4): need more rigid, shorter prompts with fewer constraints
- Cloud models: can handle nuanced instructions

**7. System prompt injection timing**
Currently `systemPrompt` is stable across the conversation (computed once from settings).
For tool mode, the system prompt should reinforce tool usage on every turn — consider appending a shorter reminder to the LAST user message rather than only the system slot.

---

## Architecture Notes

### Preview Pipeline
```
AI writes TSX → stripFences() → onOutput(content)
  → applyCode(content) → setCode(content) → CodeMirror editor opens
  → Babel transform (transformTsx) → extract component via declaredNames scan
  → Frame renders with parentCss + themeCss + iconFontCss
```

### Streaming Pipeline (Tool Mode)
```
send_chat_messages_stream(request with tools) →
  chunks: Chunk { text, thinking } → thinkingAccumulated, contentAccumulated →
  tool call chunk: tool_calls populated → last_tool_calls captured →
  stream ends → extract WriteFileParams.content from tool_calls →
  FileWritten { path, content } emitted →
  frontend: stripFences → onOutput → editor + disk write
```

### Thinking Storage
```
During stream: Zustand chatStore.thinkingContent (ephemeral, cleared on Done)
Persisted: ChatMessage.thinking?: string (separate field, not in content)
Sent to API: m.thinking → OllamaChatMessage.thinking (per Ollama API spec)
Rendered: isStreaming ? streamingThinking : message.thinking
```

---

## Eventually / Future Work

- [ ] **Message editing** — edit sent user messages, re-run from that point
- [ ] **Multi-screen navigation** — link screens via href in the Screens panel
- [ ] **OpenAI + Anthropic integrations** — separate from Ollama; Claude for thinking, GPT-4o for vision
- [ ] **Component library browser** — show saved components, drag into screens
- [ ] **Live theme preview in chat** — show mini swatch when AI generates theme tokens
- [ ] **Streaming for Coordinator / multi-turn tool loops** — current: one-shot tool call; future: multi-tool agents
- [ ] **Workflow AI nodes** — AI-powered nodes inside the workflow graph
- [ ] **Prompt templates per model** — different system prompt for qwen3 vs gemma4 vs GPT
- [ ] **Prompt versioning** — track which prompt version produced which output
- [ ] **Auto-install dependencies** — parse imports from AI code, run `bun add` for missing packages
- [ ] **Error feedback loop** — if preview crashes (Babel error), send error back to AI for self-correction
- [ ] **Chat history search** — search across all entity chats in a project
