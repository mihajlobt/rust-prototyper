# Prototyper — Living Log

> Living document. Updated as work progresses. Read alongside git history.

---

## What Was Built

### Foundation
- **Tauri v2 desktop app** — React 19 + TypeScript frontend, Rust backend
- **7 panels**: Screens, Components, Themes, APIs, Runner, Library, Workflows
- **Streaming chat** in Screens, Components, Themes — multi-turn, persistent history per entity
- **Allotment split-pane layouts** — persisted via `useAllotmentLayout` hook
- **PromptInspector** — shows full message history and model config per panel
- **Drag-to-chat** — drag files from Runner file tree into chat as @mentions

### Ollama Integration (Rust — ollama-rs)
- `to_ollama_messages()` uses `ChatMessage::user/assistant/system()` + `.with_images()` constructors
- `list_ollama_models` uses `ollama.list_local_models()`; `/api/show` still uses reqwest for capabilities
- `thinking?: string` stored as a separate `ChatMessage` field — not XML tags in content
- Image attach visible but disabled (with tooltip) for non-vision models

### Tool-Based File Generation
AI calls `write_file(content=...)` using ollama-rs streaming with manual tool-calling loop.

**Flow (tool mode):**
1. `useChat` passes `outputPath` → Rust calls `send_chat_messages_with_history_stream` with `write_file` tool schema
2. Model streams thinking + calls tool — thinking arrives in real time
3. `FileWritten { path, content }` emitted; `contentAccumulated` cleared (drops raw tool echo text)
4. Second stream turn: model confirms — confirmation text becomes the message content
5. Frontend `useChat`: `stripFences()` + `onOutput(clean)` → panel writes to disk and opens editor
6. `finalize()` reads current store state to preserve `toolCalls` set mid-stream by `attachToolCall`

**Tool UX:** prompt-kit `Tool` component — `input-streaming` (Loader2 spinner) while running, `output-available` (CheckCircle) after `FileWritten`.

**Panels:** Screens → `.tsx`, Components → `.tsx` + `generated/`, Themes → `.css`

### Chat UX
- Streaming markdown — `pre` override for code blocks (not position heuristic); Shiki with error fallback
- `CodeBlockHeader` — language badge + copy button on every fenced block
- Single-row message actions — copy, apply, retry all on one hover row
- User messages — copy + delete-from-here (trims history to that point, persists to disk)
- Stop button — swaps send → red square while streaming; `stopRef` flag aborts immediately
- Thinking — `Reasoning` component, auto-opens on stream mount; `ReasoningContent` via `ResizeObserver`
- Image attach — disabled with tooltip for non-vision models; enabled only when `caps.vision`
- Regenerate — strips last assistant message, replays last user message

### UI / Panels
- ComponentsPanel: theme chooser in preview header; `AddLibraryModal` → Runner toolbar; Clear → Trash2 + Tauri confirm
- Frame `key={selectedTheme}` — forces iframe remount so CSS vars fully reload on theme change
- Code/CSS editors auto-open when content is generated
- ThemesPanel `persistTheme` called in `onOutput` — CSS saved immediately after generation
- ThemesPanel `onOutput` strips trailing content after closing fence (removes summary text)

### Preview / Icons
- `transformTsx` always rewrites `lucide-react` imports to `window.parent.__IconLib` — `__IconLib = Lucide` is set unconditionally in `main.tsx`; prevents "Can't find variable: Home" regardless of which icon library is selected
- Icon library selection still fully works: prompts tell the AI which style to use; Frame CSS loads the icon font via `useIconFontCss(settings.iconLibrary, project)` — unaffected

---

## What Was Fixed (Recent)

| Issue | Fix |
|-------|-----|
| Raw tool call text (`write_file content="..."`) shown in chat | Suppress content accumulation before `FileWritten` in tool mode |
| `toolCalls` lost after streaming ends | `finalize()` reads current store state to preserve `toolCalls` set by `attachToolCall` |
| `Home` / lucide icons undefined in preview | `transformTsx` always rewrites lucide imports — no `iconLibrary === "lucide"` guard |
| Coordinator non-streaming (no real-time thinking) | Replaced with `send_chat_messages_with_history_stream` + manual tool loop |
| Raw tool call echo visible before FileWritten | Content not accumulated in tool mode until after FileWritten fires |
| CSS Output wrong after generation | `onOutput` strips fences + everything after closing fence; same as Apply button |
| `toolCalls` chip disappeared after Done | `finalize()` was using stale `updatedMessages` snapshot — now reads from store |
| `thinking` sent to non-thinking models | Known issue (not yet fixed) |
| Tool indicator showing before thinking | Only render after `!isEmpty` — never as empty-state replacement |
| Model wraps content in fences | `stripFences()` in useChat before `onOutput` |

---

## Known Issues

**Tool call reliability** — smaller models skip `write_file` on first turn; no fallback to `extractCode` when tool isn't called and outputPath is set.

**`thinking` in history for non-thinking models** — if user switches model mid-conversation, `thinking` fields reach a model that ignores or mishandles them. Should be stripped when `!caps.thinking`.

**JSON-envelope models** — minimax/v0-trained models return `{"code":"..."}` JSON; `stripFences` doesn't handle this.

**Function naming** — models sometimes name the entry component `Sidebar` instead of `App`; preview handles it via `declaredNames` scan but multi-component ordering can fail.

**Thinking on first turn in tool mode** — qwen3/gemma4 sometimes skip thinking on the very first message when deciding to call a tool; reliable from second turn onward.

---

## Prompt System

All panels use `write_file` tool mode. Prompts:
- WRONG/CORRECT tool call format examples (using `three-backtick` to avoid template literal issues)
- `GLOBALS` section listing pre-loaded React hooks and lucide icons
- No imports, no exports, no hardcoded hex colors, no JSON envelopes
- Theme prompts: summaries as CSS comments only; no markdown after the CSS block

**Remaining gaps:**
- `App` must be last function — not enforced explicitly enough for gemma4
- JSON-envelope extraction not handled in code
- No model-specific prompt variants yet

---

## Architecture Snapshot

```
Tool mode:  send_chat_messages_with_history_stream (turn 1, with tools)
            → real-time thinking + content chunks (content suppressed until FileWritten)
            → FileWritten { path, content } emitted → contentAccumulated cleared
            → tool result pushed to history
            → send_chat_messages_with_history_stream (turn 2, confirmation)
            → confirmation chunks → Done

Plain mode: send_chat_messages_with_history_stream (no tools)
            → Chunk{text, thinking}... → Done

Frontend:   FileWritten → stripFences → onOutput → editor + disk
            thinking → thinkingContent store → Reasoning component
            toolCalls → preserved in finalize via store read → Tool chip (prompt-kit)
```

---

## CLAUDE.md Rules (Critical)
- Never remove existing functionality without asking or for a direct bug fix
- Never substitute libraries without consulting the user
- Never suppress warnings with `#[allow]` or `_` prefix — fix root cause
- Never hardcode types that exist in external packages
- Always use `bun`/`bunx`, never `npm`/`npx`

---

## Forward

- Fallback extraction when model skips `write_file` (use `extractCode` on accumulated content if `outputPath` set but no `FileWritten` by Done)
- Strip `thinking` from history when switching to non-thinking model mid-conversation
- JSON-envelope detection in `stripFences` or a `cleanContent()` util
- `App` entry-point enforcement in component prompts with concrete example structure
- Error feedback loop: Babel/runtime crash → send error back to AI for self-correction
- Model-specific system prompt variants (qwen3 vs gemma4 vs cloud)
- OpenAI + Anthropic as separate provider integrations
- Auto-install deps from AI-generated imports via `bun add`
