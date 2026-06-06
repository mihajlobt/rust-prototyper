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
  panels/          # 10 panels: Wizard, Screens, Components, Themes, Plans, APIs, Runner, Library, Assets (+ workflows/ for WorkflowsView)
  panels/plans/    # Plans sub-components: PlanEditor, PlanPreview, PlanLayout, FormatToolbar, FrontmatterHeader, PlanCommandMenu, PlannerChat, SelectionToChat, PlansPanelParts, chips, autocomplete
  workflows/       # WorkflowsView.tsx — graph execution engine
  layout/          # Header.tsx, SidebarRail.tsx
  hooks/           # useSettings.ts, useChat.ts, useBonsai.ts, useProjectFiles.ts, useModelCapabilities.ts, useAllotmentLayout.ts, useToast.ts, useScreenCode.ts, useHotspotTracking.ts, use-mobile.ts
  lib/ipc.ts       # All invoke() wrappers — single source of truth for Rust↔TS calls
  lib/markdown/    # frontmatter.ts, directives.ts, mentions.ts, headings.ts, strip.ts — Plans markdown utilities
  lib/prompts/plans.ts  # Plans agent system prompt
  modals/          # SettingsModal, ProjectManagerModal, ExportModal, AddLibraryModal, PromptConfigModal, ComponentExportModal, SaveComponentModal (+ StylesEditor.tsx is a tabbed editor in Settings, not a true modal)
  components/ui/   # shadcn/ui primitives
src-tauri/
  src/lib.rs       # All Rust commands (44 total)
  capabilities/default.json   # Tauri plugin permissions
  tauri.conf.json  # Window config, CSP, devUrl (1420)
```

## Rust commands

Commands must be registered in `generate_handler![]` in `lib.rs`. Plugin permissions (e.g., `shell:default`, `fs:default`) must be declared in `capabilities/default.json` — missing either causes silent failure.

| Group | Commands |
|-------|----------|
| Process | `bun_dev`, `bun_build`, `bun_install`, `bun_install_sync`, `run_shell_command`, `run_shell_command_sync`, `run_shell_command_capture`, `kill_process`, `kill_all_processes`, `kill_port` |
| File System | `read_dir`, `read_file`, `write_file`, `create_dir`, `delete_file`, `delete_dir`, `rename_file`, `create_symlink`, `reveal_in_explorer` |
| HTTP | `http_request` |
| AI | `generate_completion`, `generate_completion_stream`, `stop_generation_stream`, `resolve_tool_permission`, `resolve_ask_user`, `resolve_ask_user_form`, `list_ollama_models`, `save_model_presets`, `load_model_presets` |
| Bonsai | `bonsai_start_server`, `bonsai_stop_server`, `bonsai_server_status`, `bonsai_generate_image`, `bonsai_cancel_generation`, `bonsai_list_assets`, `bonsai_delete_asset`, `bonsai_get_server_config`, `bonsai_save_server_config`, `bonsai_schedule_stop`, `bonsai_cancel_stop` |
| Export | `export_project`, `export_component` |
| Workflows | `save_workflow`, `load_workflow`, `list_workflows` |

## AI streaming

Uses Tauri Channel IPC (not events):

```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk')          append(msg.data.text);
  if (msg.event === 'ToolCall')       handleToolCall(msg.data);
  if (msg.event === 'ToolPermission') requestApproval(msg.data);
  if (msg.event === 'ToolResult')     showToolResult(msg.data);
  if (msg.event === 'AskUser')        promptUser(msg.data);     // any panel: text | choice | confirm
  if (msg.event === 'AskUserForm')   promptForm(msg.data);     // any panel: structured multi-field form
  if (msg.event === 'Done')           setLoading(false);
  if (msg.event === 'Error')          setError(msg.data.message);
};
await generateCompletionStream(model, messages, host, apiKey, channel);
```

`CompletionEvent` mirrors the Rust enum in `lib.rs` and includes 8 variants: `Chunk`, `ToolCall`, `ToolPermission`, `ToolResult`, `AskUser`, `AskUserForm`, `Done`, `Error`.

- `AskUser` fires when the model calls `ask_user`; frontend calls `resolveAskUser()` within 180s.
- `AskUserForm` fires when the model calls `ask_user_form`; frontend calls `resolveAskUserForm()` within 180s.
- Both are section-agnostic: register `onAskUser`/`onAskUserForm` in `useChat` options. If no handler is registered the backend is immediately unblocked with an empty response.

## Data persistence

- **Settings**: `tauri-plugin-store` → `settings.json` in app data dir
- **Project files**: File system via `invoke('read_file'/'write_file')` under `projects/{projectId}/`
- **Assets**: Generated images + sidecar `.json` metadata in `projects/{projectId}/assets/`
- **Workflows**: `save_workflow`/`load_workflow` Rust commands
- **Bonsai config**: `tauri-plugin-store` → `bonsai_config.json` in app data dir
- No `localStorage` except one-time migration of legacy keys on first launch

## Styling

Tailwind v4 + shadcn/ui. Tokens in `src/styles/globals.css` (`@theme inline` block). All domain-specific CSS lives in `globals.css`.

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

## Plans panel

- Files live at `projects/{id}/plans/{slug}.md`; chat history at `projects/{id}/plans/{slug}.chat.json`
- `PlansPanel` calls `useChat` directly (same pattern as ThemesPanel). No custom hook.
- Four modes: **focus** (editor only), **write** (editor + chat), **read** (preview + chat), **split** (editor + preview + chat). Each mode has its own `useAllotmentLayout` key so pane sizes persist independently.
- Live preview is `react-markdown` + `remark-directive` + custom `pre`/`code`/`blockquote` renderers. Does NOT reuse the global `Markdown` component.
- `SelectionToChat`: floating "Add to chat" button. Appears on `mouseup` (not during drag) for both editor selections (via `SelectionInfo`) and preview selections (via `window.getSelection()`).
- `panelToolFilter` / `panelMaxToolCalls` for Plans are configurable in AgentsTab (Settings → Agents → Plans column).
- `onResolvePermission` must update `toolAllowlist` when `decision === "always_allowed"` — see ThemesPanel pattern.

## Domain docs (read when relevant)

- [coding-standards.md](coding-standards.md) — File size limits, naming, types, styling rules, Allotment patterns, quality standards
- [workflows.md](workflows.md) — React Flow integration rules, data flow patterns, common workflow engine bugs
