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

### Agent Tool Loop (Rust — `src-tauri/src/agent/`)

Three-tool agentic loop: `write_file`, `read_file`, `bash`. Modular Rust module structure:

```
src-tauri/src/agent/
  mod.rs         — re-exports
  tools.rs       — build_tools() returning Vec<ToolInfo> via schemars + ollama-rs types
  executor.rs    — execute_tool() — fs write/read + tokio::process bash (30s timeout)
  agent_loop.rs  — run_agent_loop() — multi-turn loop with closing-turn termination
```

**Flow (tool mode):**
1. `useChat` passes `outputPath` → Rust calls `agent::run_agent_loop()`
2. Turn 1 WITH tools: model streams thinking + calls tool(s)
3. For each tool call: emit `ToolCall` (pending) → execute → emit `ToolResult` (success/failure)
4. `write_file` → execute writes to disk → `ToolResult` carries `path` + `content` → `onOutput()` triggers Runner
5. After write_file: closing turn WITHOUT tools → model produces text → loop breaks
6. Non-write_file tools (read_file, bash): loop continues with tools available for chaining
7. `Done` emitted after closing turn or when model produces text-only response

**Closing-turn pattern:** After write_file, the next request omits `.tools()`. The model has nothing to call and produces a text confirmation. This was confirmed in testing against both gemma4 (local) and minimax-m2.7 (cloud).

**Tool UX:** `Tool` component — `input-streaming` (Loader2) while pending, `output-available` (CheckCircle) after result, `output-error` (XCircle) on failure. All three tool types render: `write_file` shows filename, `read_file` shows file contents (truncated), `bash` shows command + stdout.

**Panels:** Screens → `.tsx`, Components → `.tsx` + `generated/`, Themes → `.css`

**Channel events (Rust → TS):**
- `ToolCall { tool, args }` — fires before execution, sets `pending: true` in store
- `ToolResult { tool, success, output, path?, content? }` — fires after execution, clears pending, triggers `onOutput` for write_file

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
| Raw tool call text (`write_file content="..."`) shown in chat | Suppress content accumulation before `ToolResult` in tool mode |
| `toolCalls` lost after streaming ends | `finalize()` reads current store state to preserve `toolCalls` set by `attachToolCall` |
| `Home` / lucide icons undefined in preview | `transformTsx` always rewrites lucide imports — no `iconLibrary === "lucide"` guard |
| Coordinator non-streaming (no real-time thinking) | Replaced with `send_chat_messages_with_history_stream` + manual tool loop |
| CSS Output wrong after generation | `onOutput` strips fences + everything after closing fence; same as Apply button |
| `toolCalls` chip disappeared after Done | `finalize()` was using stale `updatedMessages` snapshot — now reads from store |
| `thinking` sent to non-thinking models | Known issue (not yet fixed) |
| Tool indicator showing before thinking | Only render after `!isEmpty` — never as empty-state replacement |
| Model wraps content in fences | `stripFences()` in useChat before `onOutput` |
| Agent loop never terminates (model loops on write_file) | Closing turn after write_file sent without `.tools()` — forces text response |
| Single `write_file` tool, no bash or read_file | Agent module with 3 tools: write_file, read_file, bash |
| `FileWritten` event — no pending state, no failure state | Replaced with `ToolCall` (pending) + `ToolResult` (success/failure/output) pair |

---

## Known Issues

**Tool call content suppression** — `regenerate` path in `useChat.ts` was missing the `(!outputPath || toolWritten)` suppression guard that `sendMessage` has, causing raw tool call syntax text to leak into chat. Fixed.

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
Tool mode:  agent::run_agent_loop()
              Turn N WITH tools:
                send_chat_messages_with_history_stream
                → Chunk{text, thinking}... (content suppressed until ToolResult write_file)
                → ToolCall{tool, args} emitted → pending spinner in UI
                → execute_tool() → ToolResult{tool, success, output, path?, content?}
                → tool result pushed to history
              If write_file called:
                Closing turn WITHOUT tools
                → Chunk{text}... → Done
              Else (read_file/bash only):
                Loop back with tools for chaining

Plain mode: send_chat_messages_with_history_stream (no tools)
            → Chunk{text, thinking}... → Done

Frontend:   ToolCall  → attachToolCall(pending:true) → Tool card with spinner
            ToolResult → updateLastToolResult → Tool card with result/error
            ToolResult(write_file) → patchLastToolCallPath + stripFences + onOutput → editor + disk
            thinking → thinkingContent store → Reasoning component
            toolCalls → preserved in finalize via store read → Tool chip
```

**Model notes (from agent testing):**
- gemma4-26b-128k: write_file ✓, bash ✓, read_file ✗ (uses bash instead), loop terminates ✓
- minimax-m2.7 (cloud): write_file ✓, bash ✓, read_file ✓, loop terminates ✓
- Both confirmed: closing turn without tools reliably stops the loop on first write_file

---

## CLAUDE.md Rules (Critical)
- Never remove existing functionality without asking or for a direct bug fix
- Never substitute libraries without consulting the user
- Never suppress warnings with `#[allow]` or `_` prefix — fix root cause
- Never hardcode types that exist in external packages
- Always use `bun`/`bunx`, never `npm`/`npx`

---

## Forward

- Strip `thinking` from history when switching to non-thinking model mid-conversation
- JSON-envelope detection in `stripFences` or a `cleanContent()` util
- `App` entry-point enforcement in component prompts with concrete example structure
- Error feedback loop: Babel/runtime crash → send error back to AI for self-correction
- Model-specific system prompt variants (qwen3 vs gemma4 vs cloud)
- OpenAI + Anthropic as separate provider integrations
- Auto-install deps from AI-generated imports via `bun add`
- Phase 2 UI: Tool card visual differentiation — bash shows `$ command` + stdout, read_file shows file path + contents preview, write_file shows filename (all rendering via `toolPartFromRecord` in MessageList)
