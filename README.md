# Prototyper

AI-powered app generator built as a Tauri v2 desktop application.

## Tech Stack

- **Shell**: Tauri v2 (Rust backend + webview frontend)
- **Frontend**: React 19, TypeScript, Vite
- **Styling**: Tailwind CSS v4, shadcn/ui (nova preset)
- **Layout**: allotment (VS Code-style resizable splits)
- **Editor**: CodeMirror 6 (@uiw/react-codemirror)
- **Icons**: lucide-react
- **AI**: Ollama (local) + extensible for OpenAI/Claude
- **Process Engine**: Bun (spawned via tauri-plugin-shell)

## Prerequisites

- [Bun](https://bun.sh/) runtime
- [Rust](https://rustup.rs/) toolchain (`rustc`, `cargo`)
- Ollama running locally (default: `http://localhost:11434`) — optional but recommended for AI features

## Package Manager

This project uses **Bun** exclusively. Never use `npm`, `npx`, or `yarn`.

```bash
bun install        # install deps
bun add <pkg>      # add a package
bunx <tool>        # run a package binary (replaces npx)
```

## Install Dependencies

```bash
bun install
```

## Development

```bash
bun run tauri dev
```

This starts the Vite dev server and launches the native Tauri window.

## Production Build

```bash
bun run tauri build
```

Outputs platform-specific binaries in `src-tauri/target/release/bundle/`:
- Linux: `.deb`, `.AppImage`
- macOS: `.dmg`, `.app`
- Windows: `.msi`, `.exe`

## Project Structure

```
src/
  App.tsx              # App shell with allotment layout
  layout/
    Header.tsx         # View tabs, project picker, model picker, settings
    SidebarRail.tsx    # Navigation rail for 7 views
  panels/
    ScreensPanel.tsx   # Chat + AI generation + device preview
    ComponentsPanel.tsx # Prompt → component code + preview
    ThemesPanel.tsx    # Prompt → CSS theme + preview
    APIsPanel.tsx      # HTTP request/response testing
    RunnerPanel.tsx    # File tree, terminal, live preview
    LibraryPanel.tsx   # Searchable component/theme/screen/api library
  workflows/
    WorkflowsView.tsx  # Visual node-based execution canvas
  modals/
    SettingsModal.tsx      # General, AI, Styles, Prompts settings
    ProjectManagerModal.tsx # Create/switch/delete projects
    ExportModal.tsx        # Export project to zip
  components/
    CodeMirrorEditor.tsx   # CM6 editor wrapper
    PromptInspector.tsx    # Assembled prompt / JSON / cURL viewer
  hooks/
    useSettings.ts     # Tauri Store persistence hook
  lib/
    ipc.ts             # Typed Rust command wrappers
src-tauri/
  src/lib.rs           # All Rust commands (shell, fs, http, ai, export)
  src/main.rs          # Thin passthrough to lib.rs
  Cargo.toml           # Rust dependencies
  tauri.conf.json      # App config
```

## Key Features

- **7 Views**: Screens, Components, Themes, Workflows, APIs, Runner, Library
- **Resizable Panels**: VS Code-style splits via `allotment`
- **AI Generation**: Connects to Ollama for code/CSS generation
- **Real `bun dev`**: Spawns real `bun dev` processes with live terminal output
- **Project Manager**: Directory-based project storage
- **Export**: Generate framework-specific project bundles
- **Settings Persistence**: Cross-session via `tauri-plugin-store`
