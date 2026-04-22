# Prototyper — Claude Code Guide

## What This Is

A Tauri v2 desktop app for AI-assisted UI prototyping. React 19 + TypeScript frontend, Rust backend. Fully realized — no mocks, no stubs.

## Running the App

```bash
bun run tauri:dev      # auto-detects Wayland, sets WEBKIT_DISABLE_DMABUF_RENDERER=1 on Wayland
bun tauri dev          # raw (may fail on Wayland with protocol error 71)
bun tauri build        # production binaries → src-tauri/target/release/bundle/
```

> On Wayland (CachyOS), always use `bun run tauri:dev`. The env var disables WebKit DMABuf renderer to avoid GDK protocol error 71.

## Architecture

```
Frontend (React 19 + Vite, port 1420) ←IPC→ Rust backend (Tauri v2)
```

All Rust logic lives in `src-tauri/src/lib.rs`. `main.rs` is a thin passthrough.

Frontend IPC uses `@tauri-apps/api/core` (v2 — never `@tauri-apps/api/tauri`, that's v1).

## Key Directories

```
src/
  panels/          # 7 panels: Screens, Components, Themes, APIs, Runner, Library + Workflows
  workflows/       # WorkflowsView.tsx — graph execution engine
  layout/          # Header.tsx, SidebarRail.tsx
  hooks/           # useSettings.ts (Tauri Store), useStreamingCompletion.ts
  lib/ipc.ts       # All invoke() wrappers — single source of truth for Rust↔TS calls
  modals/          # Export, ProjectManager, Save, AddLibrary, PromptConfig, ComponentExport
  components/ui/   # shadcn/ui primitives
src-tauri/
  src/lib.rs       # All Rust commands (21 total)
  capabilities/default.json   # Tauri permissions
  tauri.conf.json  # Window config, CSP, devUrl (1420)
```

## Rust Commands (src-tauri/src/lib.rs)

| Group | Commands |
|-------|----------|
| Process | `bun_dev`, `bun_build`, `bun_install`, `run_shell_command`, `kill_process` |
| File System | `read_dir`, `read_file`, `write_file`, `create_dir`, `delete_file`, `delete_dir`, `rename_file` |
| HTTP | `http_request` |
| AI | `generate_completion`, `generate_completion_stream`, `list_ollama_models` |
| Export | `export_project`, `export_component` |
| Workflows | `save_workflow`, `load_workflow`, `list_workflows` |

Every command must be in both `generate_handler![]` and `capabilities/default.json` — missing either causes silent failure.

## AI Streaming

Uses Tauri Channel IPC (not events). Pattern:

```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk') append(msg.data.text);
  if (msg.event === 'Done') setLoading(false);
};
await generateCompletionStream(model, messages, host, apiKey, channel);
```

`CompletionEvent` is defined in `src/lib/ipc.ts` and mirrors the Rust enum in `lib.rs`.

## Data Persistence

- **Settings**: `tauri-plugin-store` → `settings.json` in app data dir. Hook: `useSettings()`
- **Project files**: File system via `invoke('read_file'/'write_file')` under `projects/{projectId}/`
- **Workflows**: `save_workflow`/`load_workflow` Rust commands

No `localStorage` except one-time migration of legacy keys on first launch.

## Styling

Tailwind v4 + shadcn/ui. Tokens in `src/styles/globals.css` (`@theme inline` block). Domain-specific CSS kept in `src/styles/workflows.css`, `panels.css`, `ui.css`.

## Keyboard Shortcuts

Global shortcuts use `window.addEventListener('keydown', ...)` in `useEffect` — **not** `onKeyDown` on divs with `tabIndex`. This ensures they fire regardless of focus. Current shortcuts:
- `Ctrl+S` — save file (ComponentsPanel, RunnerPanel)
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo/redo (WorkflowsView)

## Project File Structure (Runtime)

```
{appDataDir}/projects/{projectId}/
  project.json
  screens/{screenId}/screen.tsx, chat.json, attachments/
  components/{compId}/component.tsx, prompt.json
  themes/{themeId}/theme.css, prompt.json
  workflows/{workflowId}.json
  apis/{apiId}.json
  generated/         ← bun dev runs here; Runner panel previews localhost:5173
```

## Common Pitfalls

- **White screen**: `devUrl` in `tauri.conf.json` must match Vite's port (`1420`)
- **Command not found**: Must be in both `generate_handler![]` and `capabilities/default.json`
- **Wayland crash**: Use `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `bun run tauri:dev`
- **IPC timeout**: Never block async commands — use `tokio::spawn` for heavy ops
- **v1 vs v2 imports**: Always `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`
