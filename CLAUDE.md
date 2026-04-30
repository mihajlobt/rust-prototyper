# Prototyper

A Tauri v2 desktop app for AI-assisted UI prototyping. React 19 + TypeScript frontend, Rust backend.

## Setup commands

```bash
bun run tauri:dev      # auto-detects Wayland, sets WEBKIT_DISABLE_DMABUF_RENDERER=1
bun tauri dev          # raw (may fail on Wayland with protocol error 71)
bun tauri build        # production binaries → src-tauri/target/release/bundle/
```

> On Wayland (CachyOS), always use `bun run tauri:dev`.

## Architecture

```
Frontend (React 19 + Vite, port 1420) ←IPC→ Rust backend (Tauri v2)
```

All Rust logic lives in `src-tauri/src/lib.rs`. Frontend IPC uses `@tauri-apps/api/core` (v2).

## Key directories

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
  src/lib.rs       # All Rust commands (30 total)
  capabilities/default.json   # Tauri plugin permissions
  tauri.conf.json  # Window config, CSP, devUrl (1420)
```

## Rust commands

Commands must be registered in `generate_handler![]` in `lib.rs`. Plugin permissions (e.g., `shell:default`, `fs:default`) must be declared in `capabilities/default.json` — missing either causes silent failure.

| Group | Commands |
|-------|----------|
| Process | `bun_dev`, `bun_build`, `bun_install`, `bun_install_sync`, `run_shell_command`, `run_shell_command_sync`, `run_shell_command_capture`, `kill_process`, `kill_all_processes`, `kill_port` |
| File System | `read_dir`, `read_file`, `write_file`, `create_dir`, `delete_file`, `delete_dir`, `rename_file`, `reveal_in_explorer` |
| HTTP | `http_request` |
| AI | `generate_completion`, `generate_completion_stream`, `stop_generation_stream`, `list_ollama_models`, `save_model_presets`, `load_model_presets` |
| Export | `export_project`, `export_component` |
| Workflows | `save_workflow`, `load_workflow`, `list_workflows` |

## AI streaming

Uses Tauri Channel IPC (not events):

```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk') append(msg.data.text);
  if (msg.event === 'Done') setLoading(false);
};
await generateCompletionStream(model, messages, host, apiKey, channel);
```

`CompletionEvent` mirrors the Rust enum in `lib.rs`.

## Data persistence

- **Settings**: `tauri-plugin-store` → `settings.json` in app data dir
- **Project files**: File system via `invoke('read_file'/'write_file')` under `projects/{projectId}/`
- **Workflows**: `save_workflow`/`load_workflow` Rust commands
- No `localStorage` except one-time migration of legacy keys on first launch

## Styling

Tailwind v4 + shadcn/ui. Tokens in `src/styles/globals.css` (`@theme inline` block). Domain-specific CSS in `src/styles/workflows.css`, `panels.css`, `ui.css`.

## Keyboard shortcuts

Global shortcuts use `window.addEventListener('keydown', ...)` in `useEffect`:

- `Ctrl+S` — save file (ComponentsPanel, RunnerPanel)
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo/redo (WorkflowsView)

## Package manager

Always use `bun` and `bunx` — never `npm`, `npx`, or `yarn`.

```bash
bun install          # install deps
bun add <pkg>        # add package
bunx shadcn@latest   # run package binaries
bunx tsc --noEmit    # type-check
```

## Common pitfalls

- **Radix UI `ContextMenu` is uncontrolled only**: `ContextMenu.Root` does NOT accept an `open` prop. For controlled right-click menus, use `DropdownMenu.Root` with `open`/`onOpenChange` instead.
- **White screen**: `devUrl` in `tauri.conf.json` must match Vite's port (`1420`)
- **Command not found**: Must be in `generate_handler![]` in `lib.rs`, with plugin permissions in `capabilities/default.json`
- **Wayland crash**: Use `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `bun run tauri:dev`
- **IPC timeout**: Never block async commands — use `tokio::spawn` for heavy ops
- **v1 vs v2 imports**: Always `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`

## Domain docs (read when relevant)

- [coding-standards.md](coding-standards.md) — File size limits, naming, types, styling rules, Allotment patterns, quality standards
- [workflows.md](workflows.md) — React Flow integration rules, data flow patterns, common workflow engine bugs
