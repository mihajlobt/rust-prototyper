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

- `to_ollama_messages()` uses `ChatMessage::user/assistant/system()` + `.with_images()` constructors
- `list_ollama_models` uses `ollama.list_local_models()`; `/api/show` still uses reqwest for capabilities
- `thinking?: string` stored as a separate `ChatMessage` field — not XML tags in content
- Image attach restricted to vision-capable models via `caps.vision`

### Tool-Based File Generation
AI calls `write_file(content=...)` via `Coordinator` (ollama-rs) instead of us parsing code blocks.

**Flow (tool mode):**
1. `useChat` passes `outputPath` → Rust builds `ChatMessageRequest` with `WriteFileTool`
2. `Coordinator` handles multi-turn: model calls tool → executes → sends result back → final response
3. `SharedHistory` (implements `ChatHistory`) exposes full history after coordinator finishes — thinking extracted from first assistant turn
4. `CompletionEvent::FileWritten { path, content }` emitted, then final response text as `Chunk`
5. Frontend `useChat`: `stripFences()` on content → `onOutput(clean)` → panel writes to disk
6. ThemesPanel `onOutput` also strips everything after closing fence (removes summary text)

**Panels:** Screens → `.tsx`, Components → `.tsx` + `generated/`, Themes → `.css`

### Chat UX
- Streaming markdown — `pre` override for code blocks (not position heuristic); Shiki with error fallback
- `CodeBlockHeader` — language badge + copy button on every fenced block
- Tool call chips — "Wrote filename" badge after `FileWritten`
- Tool-mode animation — `Wrench` + `loading-dots` appears *after* thinking, never before
- Single-row message actions — copy, apply, retry all on one hover row
- User messages — copy + delete-from-here (trims history to that point)
- Stop button — swaps send → red square while streaming
- Thinking — `Reasoning` component, auto-opens on stream mount; `ReasoningContent` via `useEffect` + `ResizeObserver`
- Image attach — visible but disabled with tooltip for non-vision models

### UI / Panels
- ComponentsPanel: theme chooser in preview header; `AddLibraryModal` → Runner toolbar; Clear → Trash2 + Tauri confirm
- Frame `key={selectedTheme}` — forces iframe remount so CSS vars fully reload on theme change
- Code/CSS editors auto-open when content is generated
- ThemesPanel `persistTheme` called in `onOutput` — file saved immediately after generation

---

## What Was Fixed (Recent)

| Issue | Fix |
|-------|-----|
| `<think>` XML tags in history confusing model | `thinking` as separate field, maps to `OllamaChatMessage.thinking` |
| Thinking broken on subsequent turns | Proper field in history per Ollama API spec |
| Thinking invisible during streaming | `Reasoning` init with `useState(() => isStreaming)`, `ResizeObserver` for max-height |
| Tool mode thinking missing | `Coordinator` + `SharedHistory` — extract thinking from first history turn |
| Tool indicator showing before thinking | Only render after `!isEmpty` — never as empty-state replacement |
| CSS Output wrong after generation | ThemesPanel `onOutput` now strips fences + trailing content (same as Apply) |
| Coordinator final response dropped | `final_response.message.content` emitted as Chunk so chat shows model description |
| `isInline` heuristic broken for single-line blocks | `pre` override handles all block code; `code` only sees inline |
| Model wraps `write_file` content in fences | `stripFences()` in useChat before `onOutput` |
| Tool calling used wrong pattern | Switched from manual stream extraction to proper `Coordinator` + `WriteFileTool` |
| Unused imports / dead code warnings | All fixed at root cause — no `#[allow]` suppressions |
| Dead files: `chat-utils.ts`, `prompt-input.tsx` | Deleted |

---

## Known Issues

**Tool call reliability** — smaller models skip `write_file` on first turn; fallback to `extractCode(contentAccumulated)` not yet implemented for the no-tool-call case.

**Function naming** — models name components `Sidebar`, `Card` etc. Preview handles it via `declaredNames` scan but multi-component ordering can fail if `App` isn't last.

**JSON-envelope models** — minimax/v0-trained models return `{"code":"..."}` JSON; `stripFences` doesn't catch this.

**Thinking on first turn** — qwen3/gemma4 sometimes skip thinking when deciding to call a tool on the very first message; reliable from second turn onward.

**`thinking` sent to non-thinking models** — if user switches model mid-chat, history `thinking` fields reach a model that doesn't use them. Should be stripped when `!caps.thinking`.

---

## Prompt System

All panels use `write_file` tool mode. Prompts include:
- WRONG/CORRECT examples (using `three-backtick` placeholder to avoid template literal issues)
- `GLOBALS` section listing pre-loaded React hooks and lucide icons
- No imports, no exports, no hardcoded hex colors
- Theme prompts: summaries as CSS comments only; no markdown after the CSS block

**Remaining prompt gaps:**
- `App` must be last function — not yet enforced explicitly enough for gemma4
- JSON-envelope extraction not handled in code
- No model-specific prompt variants yet

---

## Architecture Snapshot

```
Tool mode:  Coordinator → WriteFileTool.call() captures content
            → SharedHistory → extract thinking from turn 1
            → emit Chunk{thinking} + FileWritten + Chunk{final text} + Done

Plain mode: send_chat_messages_stream → Chunk{text,thinking}... + Done

Frontend:   FileWritten → stripFences → onOutput → editor + disk
            thinking → thinkingContent store → Reasoning component
```

---

## Forward

- Fallback extraction when model skips `write_file` (use `extractCode` on accumulated content)
- Strip `thinking` from history for non-thinking models mid-conversation
- JSON-envelope detection in `stripFences` / a `cleanContent()` util
- `App` entry-point enforcement in component prompts with example structure
- Error feedback loop: Babel crash → send error back to AI for self-correction
- Model-specific system prompt variants (qwen3 vs gemma4 vs cloud)
- OpenAI + Anthropic as separate providers (not Ollama-proxied)
- Streaming for Coordinator turns (no native support in ollama-rs yet)
- Auto-install deps from AI-generated imports via `bun add`
