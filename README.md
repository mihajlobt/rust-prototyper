# Prototyper

AI-powered UI prototyping desktop app. Built with Tauri v2 (Rust backend) + React 19 + TypeScript frontend. Connects to local Ollama, Ollama Cloud, OpenAI, and Claude for code generation, and spawns real `bun dev` processes for live preview.

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Shell | Tauri v2 | `2` |
| Frontend | React | `^19.1.0` |
| Language | TypeScript | `~5.8.3` |
| Build | Vite | `^7.0.4` |
| Styling | Tailwind CSS | `^4.2.4` |
| UI Kit | shadcn/ui (radix-ui) | `radix-ui ^1.4.3` |
| Layout | allotment | `^1.20.5` |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`) | `^4.25.9` |
| Icons | lucide-react | `^1.11.0` |
| State | Zustand | `^5.0.12` |
| Data fetching | TanStack React Query | `^5.100.1` |
| Graph | React Flow (`@xyflow/react`) | `^12.10.2` |
| Terminal | xterm.js (`@xterm/xterm`) | `^6.0.0` |
| Runtime | Bun | any recent |
| Backend | Rust (edition 2021) | — |
| AI | Ollama (`ollama-rs`) + OpenAI + Claude via `reqwest` | `0.3` |

<details>
<summary>Key Tauri plugins (Rust)</summary>

- `tauri-plugin-shell` — process spawning
- `tauri-plugin-fs` — file system (with `watch` feature)
- `tauri-plugin-http` — HTTP client
- `tauri-plugin-store` — persistent key-value store
- `tauri-plugin-clipboard` — clipboard access
- `tauri-plugin-dialog` — native file/message dialogs
- `tauri-plugin-mcp-bridge` — MCP bridge (debug builds only)
</details>

## Prerequisites

- [Bun](https://bun.sh/) — package manager and JS runtime
- [Rust](https://rustup.rs/) — `rustc` + `cargo`
- Linux deps: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc. (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
- Optional: [Ollama](https://ollama.com) running locally for AI features (default `http://localhost:11434`)
- Optional: OpenAI or Anthropic API keys for cloud AI providers

## Install & Run

```bash
bun install              # install all dependencies
bun run tauri:dev        # starts Vite + Tauri (auto-detects Wayland)
# — or —
bun tauri dev            # raw command (may fail on Wayland — see pitfalls)
```

> **Wayland users** (CachyOS, etc.): always use `bun run tauri:dev`. It sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` automatically.

## Production Build

```bash
bun tauri build          # outputs to src-tauri/target/release/bundle/
```

Platform outputs: `.deb` + `.AppImage` (Linux), `.dmg` + `.app` (macOS), `.msi` + `.exe` (Windows).

## Project Structure

```
src/
  App.tsx                  # App shell — allotment layout, view routing, dark/accent theming
  main.tsx                 # React entry point
  layout/
    Header.tsx             # 8 view tabs, model picker, project selector, settings
    SidebarRail.tsx        # File explorer sidebar with CRUD for screens/components/etc.
  panels/
    ScreensPanel.tsx       # Chat + AI generation + device preview
    ComponentsPanel.tsx   # Prompt → component code + preview
    ThemesPanel.tsx        # Prompt → CSS theme + preview
    FlowsPanel.tsx         # Flow routing view (renders FlowsView)
    FlowsView.tsx          # Flow canvas logic
    APIsPanel.tsx          # HTTP request/response testing
    RunnerPanel.tsx        # File tree, terminal, live preview
    RunnerFileTree.tsx     # Runner's file browser
    RunnerDialogs.tsx      # Runner dialog components
    LibraryPanel.tsx       # Searchable component/theme/screen/api library
  workflows/
    WorkflowsView.tsx      # Visual node-based execution canvas
    useWorkflowExecution.ts
    useWorkflowPersistence.ts
    WorkflowActionsContext.ts
    NodePropertiesPanel.tsx
    NodeFieldSections.tsx
    nodeTypes.tsx
    Lasso.tsx / lassoUtils.ts
    OutputChatPanel.tsx
    templates.ts
  modals/
    SettingsModal.tsx          # General, AI, Styles, Prompts settings
    ProjectManagerModal.tsx    # Create / switch / delete projects
    ExportModal.tsx             # Export project to zip
    AddLibraryModal.tsx         # Add library dependencies
    PromptConfigModal.tsx       # Configure prompt templates
    ComponentExportModal.tsx    # Export single component
    SaveComponentModal.tsx      # Save generated component
  components/
    chat/                   # ChatInput, MessageList, MentionPicker, etc.
    ui/                     # 36 shadcn/ui primitives + domain-specific UI components
    CodeMirrorEditor.tsx    # CM6 editor wrapper
    PromptInspector.tsx     # Assembled prompt / JSON / cURL viewer
    ModelPicker.tsx         # Provider + model selector
    ModelOptionsPopover.tsx # Model parameter controls
    ProjectExplorer.tsx     # Tree navigation component
    AttachComposer.tsx
    XTerminal.tsx            # xterm.js terminal wrapper
    ErrorBoundary.tsx
    PreviewErrorBoundary.tsx
  hooks/
    useSettings.ts              # Tauri Store persistence
    useChat.ts                   # Chat session management
    useProjectFiles.ts          # Project file operations + query keys
    useModelCapabilities.ts     # Model capability detection
    useAllotmentLayout.ts       # Pane size persistence
    useToast.ts                  # Toast notification hook
  stores/
    appStore.ts                  # Global app settings (Zustand)
    chatStore.ts                 # Chat state (Zustand)
    projectSettingsStore.ts      # Per-project settings (Zustand)
    uiStore.ts                   # UI state (Zustand)
  lib/
    ipc.ts                  # All invoke() wrappers — single source of truth for Rust↔TS calls
    notifications.ts        # Safe IPC wrappers with toast notifications
    navigation.ts           # Screen navigation helpers
    queryClient.ts          # React Query client
    queryKeys.ts            # Query key factory
  types/
    chat.ts                 # Shared chat types
  styles/
    globals.css             # Tailwind v4 @theme inline block + CSS custom properties
src-tauri/
  src/
    lib.rs                   # App setup, plugins, generate_handler![] (32 commands)
    main.rs                  # Thin passthrough to lib.rs
    commands/
      process.rs             # Bun/shell spawning, kill
      fs.rs                  # File system CRUD + symlink + reveal
      http.rs                # HTTP client
      ai.rs                  # Streaming completion, tool permissions
      ai_providers.rs        # OpenAI/Claude provider implementations
      ai_ollama.rs           # Ollama-specific logic + model listing + presets
      export.rs              # Project/component export
      workflows.rs           # Workflow persistence
      mod.rs
    agent/                   # AI agent module
    sandbox/                 # Linux sandbox (landlock/seccomp)
    bin/                     # Binary utilities
  capabilities/default.json  # Tauri plugin permissions
  tauri.conf.json            # Window config (1400×900), CSP, devUrl (port 1420)
  Cargo.toml                 # Rust dependencies
```

## Views (8 Panels)

| View | ID | Panel Component | Description |
|------|----|-----------------|-------------|
| Screens | `screens` | `ScreensPanel` | Chat + AI generation + device preview |
| Components | `components` | `ComponentsPanel` | Prompt → component code + live preview |
| Themes | `themes` | `ThemesPanel` | Prompt → CSS theme generation |
| Flows | `flows` | `FlowsPanel` → `FlowsView` | Visual flow routing between screens |
| Workflows | `workflows` | `WorkflowsView` | Node-based execution canvas (React Flow) |
| APIs | `apis` | `APIsPanel` | HTTP request/response testing |
| Runner | `runner` | `RunnerPanel` | File tree, terminal (xterm.js), live preview |
| Library | `library` | `LibraryPanel` | Searchable library of components, themes, screens, APIs |

## Rust Commands (32 total)

All commands must be registered in `generate_handler![]` in `lib.rs`. Plugin permissions (e.g., `shell:default`, `fs:default`) must be declared in `capabilities/default.json` — missing either causes silent failure.

| Group | Commands |
|-------|----------|
| Process (10) | `bun_dev`, `bun_build`, `bun_install`, `bun_install_sync`, `run_shell_command`, `run_shell_command_sync`, `run_shell_command_capture`, `kill_process`, `kill_all_processes`, `kill_port` |
| File System (9) | `read_dir`, `read_file`, `write_file`, `create_dir`, `delete_file`, `delete_dir`, `rename_file`, `create_symlink`, `reveal_in_explorer` |
| HTTP (1) | `http_request` |
| AI (7) | `generate_completion`, `generate_completion_stream`, `stop_generation_stream`, `resolve_tool_permission`, `list_ollama_models`, `save_model_presets`, `load_model_presets` |
| Export (2) | `export_project`, `export_component` |
| Workflows (3) | `save_workflow`, `load_workflow`, `list_workflows` |

All commands registered in `generate_handler![]` in `lib.rs`. Plugin permissions (e.g., `shell:default`, `fs:default`) must be declared in `capabilities/default.json` — missing either causes silent failure.

## AI Providers

The app supports **4 AI providers** with a unified streaming interface:

| Provider | Host | Auth |
|----------|------|------|
| Ollama (local) | Configurable (default: `http://localhost:11434`) | None |
| Ollama Cloud | `https://ollama.com` | API key |
| OpenAI | `https://api.openai.com` | API key |
| Claude | `https://api.anthropic.com` | API key |

Streaming uses Tauri Channel IPC (not events):

```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk')    append(msg.data.text);
  if (msg.event === 'ToolCall') handleToolCall(msg.data);
  if (msg.event === 'ToolPermission') requestApproval(msg.data);
  if (msg.event === 'Done')     setLoading(false);
};
await generateCompletionStream(model, messages, host, apiKey, onEvent: channel, ...);
```

`CompletionEvent` mirrors the Rust enum and includes `Chunk`, `ToolCall`, `ToolPermission`, `ToolResult`, `Done`, and `Error` variants.

## Data Persistence

| Data | Mechanism | Location |
|------|-----------|----------|
| App settings | `tauri-plugin-store` | `settings.json` in app data dir |
| Project files | File system IPC (`read_file`/`write_file`) | `projects/{projectId}/` under app data |
| Workflows | `save_workflow`/`load_workflow` Rust commands | Per-project workflow directory |
| Model presets | `save_model_presets`/`load_model_presets` | App data dir |
| Pane sizes | `useAllotmentLayout` hook | Tauri Store |

> No `localStorage` except one-time migration of legacy keys on first launch.

## Styling

- **Tailwind CSS v4** with `@tailwindcss/vite` plugin and `@theme inline` block in `globals.css`
- **shadcn/ui** components in `src/components/ui/` (36 primitives, including domain-specific ones like `code-block`, `chat-container`, `message`, `file-upload`, `tool`, `ToolPermissionCard`)
- **Custom CSS properties** for theming: `--primary`, `--ring`, `--sidebar-primary` (toggled from `appStore`)
- **Dark mode**: class-based (`document.documentElement.classList.toggle("dark", ...)`)
- **Accent color**: dynamically set via CSS custom properties from settings
- **Glow/AMOLED modes**: `glow-subtle`, `glow-full`, `amoled` class toggles

## Keyboard Shortcuts

| Shortcut | Action | Component |
|----------|-------|-----------|
| `Ctrl+S` | Save file | ComponentsPanel, RunnerPanel |
| `Ctrl+Z` | Undo | WorkflowsView |
| `Ctrl+Shift+Z` | Redo | WorkflowsView |

Shortcuts use `window.addEventListener('keydown', ...)` in `useEffect`.

## Package Manager Rules

**Always use `bun` and `bunx`** — never `npm`, `npx`, or `yarn`.

```bash
bun install              # install dependencies
bun add <pkg>            # add package
bunx shadcn@latest       # run package binaries (replaces npx)
bunx tsc --noEmit        # type-check
```

## Common Pitfalls

- **Radix UI `ContextMenu` is uncontrolled only**: `ContextMenu.Root` does NOT accept an `open` prop. For controlled right-click menus, use `DropdownMenu.Root` with `open`/`onOpenChange` instead.
- **White screen on launch**: `devUrl` in `tauri.conf.json` must match Vite's port (`1420`).
- **Command not found**: Must be in `generate_handler![]` in `lib.rs` AND plugin permissions in `capabilities/default.json` — missing either causes silent failure.
- **Wayland crash (protocol error 71)**: Use `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `bun run tauri:dev`.
- **IPC timeout**: Never block async commands — use `tokio::spawn` for heavy ops.
- **Tauri v1 vs v2 imports**: Always `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`.
- **Allotment `resize()` crashes**: Never call `resize()` in `useEffect` or `requestAnimationFrame`. Use the `visible` prop for show/hide. `resize()` is only safe in event handlers.

## Further Reading

- [coding-standards.md](coding-standards.md) — File size limits, naming rules, type rules, styling rules, Allotment patterns, quality standards
- [workflows.md](workflows.md) — React Flow integration, data flow patterns, common workflow engine bugs
- [CLAUDE.md](CLAUDE.md) — Quick-reference architecture guide for AI assistants