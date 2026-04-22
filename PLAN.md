# Prototyper → Tauri v2 Desktop App: Full Realization Plan

## Executive Summary

Migrate the Prototyper prototype (mocked React app running in a browser) to a **fully functional Tauri v2 desktop application**. Every mocked feature becomes real. No compromises.

| Aspect | Before (Prototype) | After (Realized) |
|--------|-------------------|------------------|
| **Shell** | Browser tab (`Bun.serve`) | Native desktop window (Tauri v2) |
| **Styling** | ~1,000 lines custom CSS | Tailwind v4 + shadcn/ui + domain CSS |
| **Icons** | 34 inline SVGs in `src/icons.tsx` | `lucide-react` |
| **Layout** | Fixed-width divs with fake sashes | `allotment` resizable VS Code splits |
| **Code Editor** | CodeMirror 5 | `@uiw/react-codemirror` (CM6) |
| **AI Models** | Hardcoded mock list | Live Ollama / OpenAI / Claude |
| **AI Generation** | Empty `onSend` handler | Streaming completions via Rust IPC |
| **File System** | `localStorage` only | `tauri-plugin-fs` in app data dir |
| **Terminal** | HTML/CSS fake terminal | Real PTY via `tauri-plugin-shell` |
| **Preview** | Static mock components | Live `bun dev` in iframe |
| **Runner** | Mocked buttons | Real Bun process management |
| **Projects** | `localStorage` JSON | Directory-based project storage |
| **Export** | No-op button | Zip generation + native save dialog |
| **APIs** | Hardcoded endpoints | Real HTTP via `tauri-plugin-http` |
| **Workflows** | Fake 900ms timer execution | Real graph execution with AI calls per node |

---

## Architecture

```
┌─────────────────────────────────────────────┐
│             Tauri v2 (Rust)                 │
│  ┌─────────┐ ┌─────────┐ ┌──────────────┐  │
│  │ Shell   │ │ FS      │ │ HTTP         │  │
│  │ Plugin  │ │ Plugin  │ │ Plugin       │  │
│  └────┬────┘ └────┬────┘ └──────┬───────┘  │
│       │           │             │          │
│  ┌────┴───────────┴─────────────┴────────┐ │
│  │           lib.rs Commands              │ │
│  │  bun_dev / bun_build / kill_process    │ │
│  │  read_dir / read_file / write_file     │ │
│  │  http_request / generate_completion    │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
                    ▲ IPC invoke / listen
┌─────────────────────────────────────────────┐
│  Frontend (React 19 + TypeScript + Vite)    │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ shadcn   │ │lucide    │ │ allotment    │ │
│  │ /ui      │ │ -react   │ │ splits       │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
│                                             │
│  Panels: 7 views (Screens, Components,      │
│  Themes, Workflows, APIs, Library, Runner)  │
│                                             │
│  Modals: Export, ProjectManager, Save,      │
│  AddLibrary, PromptConfig, ComponentExport  │
│                                             │
│  Core: PromptInspector, AttachComposer,     │
│  ModelPicker, SettingsModal, CodeMirror 6   │ │
└─────────────────────────────────────────────┘
```

### Bun's Role in the Architecture

**Bun is NOT replaced by Tauri — it becomes the engine inside it.**

| Layer | Bun's Role |
|-------|-----------|
| **Prototyper App Shell** | Tauri v2 window (no Bun) |
| **Frontend Dev Server** | Vite (started by `bun tauri dev`) |
| **Generated Project Preview** | `bun dev` spawned by Rust via `tauri-plugin-shell` |
| **Generated Project Build** | `bun build` spawned by Rust |
| **Generated Project Dependencies** | `bun install` spawned by Rust |
| **Frontend Bundling** | Vite handles its own bundling; Bun is the runtime |

**Key distinction**: The Prototyper app itself uses Vite for its frontend bundling (standard with Tauri). Bun is what the **Runner panel** executes to preview user-generated projects. When the user clicks "bun dev" in the Runner panel, Rust spawns a Bun process that serves the generated app on `localhost:5173`, which the Runner preview iframe then loads.

---

## Phase 0: Scaffold (Foundation)

**Goal**: Fresh `tauri-ui` Vite scaffold + migrate existing source files.

### 0.1 Create Scaffold via `tauri-ui`
**Why `tauri-ui`**: Combines official `shadcn/ui init` + `create-tauri-app` with desktop-ready defaults (no startup flash, external links open in browser, no overscroll, debug panel). No forks, always upstream.

```bash
bunx create-tauri-ui@latest --template vite
```
- Select: Vite + React + TypeScript + shadcn/ui
- Batteries: include debug panel, dashboard starter

### 0.2 Migrate Source Files
- Copy all `src/` files from existing project into scaffold
- Preserve `tsconfig.json` path aliases (`@/*`)
- Merge `package.json` dependencies
- **Important**: `main.rs` stays thin — all logic lives in `lib.rs` (required for mobile builds):
  ```rust
  // src-tauri/src/main.rs
  #![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
  fn main() { app_lib::run(); }
  ```

### 0.3 Configure Tauri
- `tauri.conf.json`:
  - `build.devUrl`: `http://localhost:5173`
  - `build.frontendDist`: `../dist`
  - `build.beforeDevCommand`: `bun run dev`
  - `build.beforeBuildCommand`: `bun run build`
  - `app.windows`: default title "Prototyper", size 1400x900
  - `app.security.csp`: `default-src 'self'; img-src 'self' data:; connect-src 'self' http://localhost:*`
- `Cargo.toml`:
  ```toml
  [lib]
  name = "app_lib"
  crate-type = ["staticlib", "cdylib", "rlib"]

  [dependencies]
  tauri = { version = "2", features = [] }
  tauri-plugin-shell = "2"
  tauri-plugin-fs = "2"
  tauri-plugin-http = "2"
  tauri-plugin-store = "2"
  tauri-plugin-clipboard = "2"
  tauri-plugin-dialog = "2"
  tokio = { version = "1", features = ["full"] }
  serde = { version = "1", features = ["derive"] }
  serde_json = "1"
  thiserror = "1"
  ```
- `capabilities/default.json`:
  ```json
  {
    "$schema": "../gen/schemas/desktop-schema.json",
    "identifier": "default",
    "windows": ["main"],
    "permissions": [
      "core:default",
      "shell:default",
      "fs:default",
      "http:default",
      "store:default",
      "clipboard:default",
      "dialog:default"
    ]
  }
  ```

### 0.4 Install Frontend Dependencies
- `allotment` — resizable splits
- `@uiw/react-codemirror` + language packs — CodeMirror 6
- `lucide-react` — icons
- `zod` — validation
- `@tanstack/react-query` — data fetching / caching

### 0.5 Tauri v2 Critical Rules
**Always Do**:
- Register every command in `tauri::generate_handler![cmd1, cmd2, ...]`
- Return `Result<T, E>` from commands for proper error handling
- Use `Mutex<T>` for shared state accessed from multiple commands
- Use owned types (`String`, not `&str`) in async commands
- Add capabilities before using any plugin features
- Use `lib.rs` for all shared code (required for mobile builds)
- Use `#[cfg_attr(mobile, tauri::mobile_entry_point)]` on `pub fn run()` in `lib.rs`

**Never Do**:
- Never use borrowed types (`&str`) in async commands
- Never block the main thread — use async for I/O
- Never hardcode paths — use Tauri path APIs (`app.path()`)
- Never skip capability setup

**Common Mistakes to Avoid**:
| Issue | Root Cause | Solution |
|-------|-----------|----------|
| "Command not found" | Missing from `generate_handler![]` | Register in handler + capability |
| Plugin feature silently fails | Missing permission in capability | Add plugin permission string |
| White screen on launch | Frontend not building / devUrl mismatch | Check `beforeDevCommand` and port |
| IPC timeout | Blocking async command | Use spawn, don't block |
| Feature works desktop, breaks mobile | Desktop-only API used | Check mobile support matrix |

---

## Phase 1: Global Infrastructure

### 1A. Icon Migration (`src/icons.tsx` → `lucide-react`)
**Scope**: Replace all 34 custom inline SVG icons.

| Custom Icon | lucide-react | Used In |
|-------------|-------------|---------|
| `input` | `ArrowRightToLine` | Node palette |
| `output` | `ArrowLeftToLine` | Node palette |
| `sparkles` | `Sparkles` | Settings, panels |
| `list` | `List` | Node palette |
| `palette` | `Palette` | Header, themes, workflows |
| `cube` | `Box` | Header, model picker, library |
| `flow` | `GitBranch` | Header, workflows |
| `chip` | `Cpu` | Node palette |
| `play` | `Play` | Header, runner, workflows |
| `stop` | `Square` | Runner, workflows |
| `save` | `Save` | Components, modals |
| `search` | `Search` | Sidebar, palette, browser, library |
| `plus` | `Plus` | Settings, sidebar, workflows |
| `trash` | `Trash2` | Settings, workflows, project manager |
| `folder` | `Folder` | Header, workflows, project manager |
| `file` | `FileCode` | Components, screens, APIs, modals |
| `chevR` | `ChevronRight` | APIs |
| `chevD` | `ChevronDown` | Model picker, themes, style picker |
| `x` | `X` | Everywhere |
| `check` | `Check` | Settings, modals |
| `cog` | `Settings` | Header |
| `zap` | `Zap` | Settings, send button |
| `link` | `Link` | Screens, APIs, node palette |
| `cpu` | `Server` | Host picker, model picker |
| `terminal` | `Terminal` | APIs, runner, components, themes |
| `layers` | `Layers` | Style preset picker |
| `grid` | `LayoutGrid` | Header, library |
| `eye` | `Eye` | Prompt inspector |
| `fit` | `Maximize2` | Runner |
| `zoomIn` | `ZoomIn` | Workflows |
| `zoomOut` | `ZoomOut` | Workflows |
| `branch` | `GitBranch` | Node palette |
| `book` | `BookOpen` | Node palette |
| `send` | `Send` | Header, library, model picker |
| `clip` | `Paperclip` | Attach composer |
| `image` | `Image` | Attach composer |
| `copy` | `Copy` | Prompt inspector |
| `upload` | `Upload` | Attach composer |

**Deliverable**: Delete `src/icons.tsx`. All components import from `lucide-react`.

### 1B. Theme Migration (Custom CSS → Tailwind v4 + shadcn)
**Scope**: Remap existing design tokens to shadcn's CSS variable system.

**Token mapping**:
- Neutrals `--n-0` through `--n-11` → `--background`, `--foreground`, `--muted`, `--card`, `--popover`, `--border`
- Accents `--acc` → `--primary`, `--accent`
- Text `--fg`, `--fg-dim`, `--fg-mute` → `--foreground`, `--muted-foreground`
- Category colors `--cat-*` → custom CSS variables (workflow-specific)
- Density, glow, grid → Tailwind utility classes + data attributes

**Component mapping**:
- `.btn` / `.btn--acc` → shadcn `<Button>`
- `.input` → shadcn `<Input>`
- `.textarea` → shadcn `<Textarea>`
- `.card` → shadcn `<Card>`
- `.pill` → shadcn `<Badge>`
- `.tag` → shadcn `<Badge variant="secondary">`
- `.seg` → custom `<SegmentedControl>` or shadcn `<ToggleGroup>`

**CSS file strategy**:
- `src/styles/tokens.css` → Remapped to shadcn theme variables in `oklch()` format
- `src/styles/base.css` → Migrate to Tailwind utilities gradually; keep layout classes
- `src/styles/workflows.css` → **Keep** (domain-specific: nodes, edges, canvas)
- `src/styles/panels.css` → **Keep** (domain-specific: terminal, chat, endpoints)
- `src/styles/ui.css` → **Keep** (domain-specific: attach composer, prompt inspector)

### 1C. Layout Migration (Fake Splits → `allotment`)
**Scope**: Replace every `.split`, `.split-pane`, `.sash` with `<Allotment>`.

| Location | Allotment Configuration |
|----------|------------------------|
| `App.tsx` body (sidebar + main view) | `<Allotment>` horizontal: `[SidebarRail (min:180, max:320), MainView]` |
| `ScreensPanel` (chat + preview) | `<Allotment>` horizontal: `[ChatPane (min:300), PreviewPane (min:400)]` |
| `ComponentsPanel` (prompt + preview + code drawer) | `<Allotment>` horizontal outer, `<Allotment vertical>` inner for code drawer |
| `ThemesPanel` (prompt + preview + css drawer) | Same pattern as ComponentsPanel |
| `APIsPanel` (api list + detail) | `<Allotment>` horizontal: `[ApiList (min:220), ApiDetail]` |
| `RunnerPanel` (files + editor/preview + terminal) | Nested: horizontal `[Files (min:180), EditorPreview]`, vertical `[Editor, Terminal (snap)]` |
| `WorkflowsView` (palette + browser + canvas + props) | Nested: horizontal `[Palette (min:200), BrowserCanvas, Props (min:260)]`, vertical `[Browser, Canvas]` |

**CSS**: Import `allotment/dist/style.css` in `main.tsx`.

### 1D. CodeMirror 5 → 6 Migration
**Scope**: Replace `src/components/CodeMirrorEditor.tsx`.

**New implementation**:
```tsx
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';

const modeMap = {
  javascript: javascript(),
  jsx: javascript({ jsx: true }),
  css: css(),
  json: json(),
  markdown: markdown(),
  shell: javascript(), // fallback
};
```

**Themes**: Map 7 existing themes to `@uiw/codemirror-themes` equivalents or custom extensions.

---

## Phase 2: Data Layer & Persistence

### 2A. Settings Persistence (`tauri-plugin-store`)
- **Store file**: `settings.json` in Tauri app data directory
- **Keys**: `view`, `modelId`, `project`, `stylePreset`, `tweaks`, `prompts`, `styles`
- **Hook**: `useSettings()` wrapping Store with async get/set
- **Migration**: Read existing `localStorage` keys (`pt.view`, `pt.model`, etc.) on first launch, then migrate to Store

### 2B. Project Data Persistence (`tauri-plugin-fs`)
- **Base directory**: `{appDataDir}/projects/`
- **Structure per project**:
  ```
  projects/{projectId}/
  ├── project.json          # metadata: name, created, updated
  ├── screens/
  │   └── {screenId}/
  │       ├── screen.tsx
  │       ├── chat.json
  │       └── attachments/
  ├── components/
  │   └── {compId}/
  │       ├── component.tsx
  │       └── prompt.json
  ├── themes/
  │   └── {themeId}/
  │       ├── theme.css
  │       └── prompt.json
  ├── workflows/
  │   └── {workflowId}.json
  ├── apis/
  │   └── {apiId}.json
  └── generated/            # Bun project output (full directory)
      ├── package.json
      ├── src/
      ├── public/
      └── ...
  ```

### 2C. AI Model Configuration
- **Store**: `models.json` in app data dir
- **Content**: Ollama host URL, API keys for remote models, custom model definitions
- **Default**: `localhost:11434` with `qwen2.5-coder:32b`

---

## Phase 3: Rust Backend Commands

Create `src-tauri/src/lib.rs` with all application logic. `main.rs` remains a thin passthrough.

### 3A. Process Management (`tauri-plugin-shell`)
```rust
use tauri::{AppHandle, Emitter};
use std::sync::Mutex;
use std::collections::HashMap;

#[tauri::command]
async fn bun_dev(cwd: String, port: u16, app: AppHandle) -> Result<u32, String> {
    // Spawn bun dev, emit output via events
    // Return PID for kill_process
}

#[tauri::command]
async fn bun_build(cwd: String, app: AppHandle) -> Result<String, String>;

#[tauri::command]
async fn bun_install(cwd: String, app: AppHandle) -> Result<String, String>;

#[tauri::command]
async fn run_shell_command(cwd: String, command: String, app: AppHandle) -> Result<u32, String>;

#[tauri::command]
async fn kill_process(pid: u32, state: State<'_, Mutex<AppState>>) -> Result<(), String>;
```

**Auto-kill on exit**: Register `app.listen("tauri://close", ...)` in `lib.rs::run()` to terminate all tracked child processes.

**Event streaming**: All commands emit `"terminal-output"` events: `{ pid, line, source: "stdout" | "stderr" }`.

**Important**: Use `app.emit("terminal-output", payload)` for streaming. Frontend listens via:
```typescript
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen('terminal-output', (e) => console.log(e.payload));
```

### 3B. File System (`tauri-plugin-fs`)
```rust
#[tauri::command]
async fn read_dir(path: String) -> Result<Vec<FileEntry>, String>;

#[tauri::command]
async fn read_file(path: String) -> Result<String, String>;

#[tauri::command]
async fn write_file(path: String, content: String) -> Result<(), String>;

#[tauri::command]
async fn create_dir(path: String) -> Result<(), String>;

#[tauri::command]
async fn delete_file(path: String) -> Result<(), String>;

#[tauri::command]
async fn rename_file(from: String, to: String) -> Result<(), String>;
```

### 3C. HTTP Client (`tauri-plugin-http`)
```rust
#[tauri::command]
async fn http_request(
    method: String,
    url: String,
    headers: HashMap<String, String>,
    body: Option<String>
) -> Result<HttpResponse, String>;
```

### 3D. AI Generation
```rust
#[tauri::command]
async fn generate_completion(
    model: String,
    messages: Vec<Message>,
    stream: bool,
    app: AppHandle
) -> Result<String, String>;

#[tauri::command]
async fn list_ollama_models(host: String) -> Result<Vec<ModelInfo>, String>;
```

**Implementation details**:
- If model ID matches Ollama format (`model:tag`): POST to `{host}/api/chat`
- If model ID matches remote (claude/gpt): POST to respective API with stored API key
- If `stream=true`: Emit chunks via `"completion-chunk"` events, then return `""`
- If `stream=false`: Return full response string

### 3E. Export / Distribution
```rust
#[tauri::command]
async fn export_project(
    project_id: String,
    format: String,
    include_apis: bool,
    include_theme: bool,
    include_components: bool,
    include_tests: bool
) -> Result<String, String>; // Returns path to generated zip

#[tauri::command]
async fn export_component(
    project_id: String,
    component_id: String,
    format: String,
    include_types: bool,
    include_storybook: bool,
    include_tests: bool
) -> Result<String, String>;
```

### 3F. App State & lib.rs Structure
```rust
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::{Manager, AppHandle, Emitter};
use tauri_plugin_store::Store;

struct AppState {
    active_processes: Mutex<HashMap<u32, Child>>,
    settings: Mutex<Store>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Mutex::new(AppState { 
            active_processes: Mutex::new(HashMap::new()),
            settings: Mutex::new(Store::new("settings.json")),
        }))
        .invoke_handler(tauri::generate_handler![
            bun_dev, bun_build, bun_install, run_shell_command, kill_process,
            read_dir, read_file, write_file, create_dir, delete_file, rename_file,
            http_request,
            generate_completion, list_ollama_models,
            export_project, export_component,
        ])
        .setup(|app| {
            // Auto-kill on exit
            let app_handle = app.handle().clone();
            app.listen("tauri://close", move |_| {
                // Kill all tracked processes
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**Note**: Every command MUST be in `generate_handler![]` AND in `capabilities/default.json`. Missing either = silent failure.

### 3G. Error Handling Pattern
```rust
use thiserror::Error;

#[derive(Debug, Error)]
enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Process error: {0}")]
    Process(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

#[tauri::command]
fn risky_operation() -> Result<String, AppError> {
    Ok("success".into())
}
```

### 3H. Channel Streaming (for AI completions)
```rust
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
enum CompletionEvent {
    Chunk { text: String },
    Done,
    Error { message: String },
}

#[tauri::command]
async fn generate_completion_stream(
    model: String,
    messages: Vec<Message>,
    on_event: Channel<CompletionEvent>,
) -> Result<(), String> {
    // Stream chunks via on_event.send()
    on_event.send(CompletionEvent::Chunk { text: "...".into() }).unwrap();
    on_event.send(CompletionEvent::Done).unwrap();
    Ok(())
}
```

**Frontend**:
```typescript
import { invoke, Channel } from '@tauri-apps/api/core';

const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk') setText((t) => t + msg.data.text);
  if (msg.event === 'Done') setLoading(false);
};
await invoke('generate_completion_stream', { model, messages, onEvent: channel });
```

---

## Frontend IPC Patterns (Tauri v2)

### Calling Rust Commands
```typescript
import { invoke } from '@tauri-apps/api/core';

// v2 API — NOT @tauri-apps/api/tauri (that's v1)
const pid = await invoke<number>('bun_dev', { cwd: './generated', port: 5173 });
await invoke('kill_process', { pid });
```

### Listening to Events
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('terminal-output', (e) => {
  console.log(e.payload); // { pid, line, source: 'stdout' | 'stderr' }
});
// Call unlisten() when component unmounts
```

### File System Paths in Frontend
```typescript
import { convertFileSrc } from '@tauri-apps/api/core';

// Convert Rust file path to a URL the webview can load
const imgUrl = convertFileSrc('/path/to/image.png');
// Use in <img src={imgUrl} />
```

### Window Access
```typescript
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const appWindow = getCurrentWebviewWindow();
await appWindow.setTitle('Prototyper — My Project');
```

---

## Phase 4: Panel-by-Panel Realization

### 4A. Header (`src/layout/Header.tsx`)
**Current**: Tab switcher, project pill, model picker, style picker, settings gear.

**Realized**:
- **Project pill**: `useProject()` hook reads from Tauri FS. Click opens ProjectManagerModal.
- **Model picker**: Calls `invoke('list_ollama_models')` to populate. Selection stored in Tauri Store.
- **Style preset picker**: Reads from `settings.json`.
- **Settings gear**: Opens SettingsModal (persist to Store).
- **Host picker**: Editable Ollama host URL, persisted to Store. Green dot shows actual connectivity (ping on interval).

### 4B. SidebarRail (`src/layout/SidebarRail.tsx`)
**Current**: Static lists from `data.ts`.

**Realized**:
- **Screens tab**: `invoke('read_dir', { path: 'projects/{id}/screens' })`
- **Components tab**: `invoke('read_dir', { path: 'projects/{id}/components' })`
- **Themes tab**: `invoke('read_dir', { path: 'projects/{id}/themes' })`
- **APIs tab**: `invoke('read_dir', { path: 'projects/{id}/apis' })`
- **Runner tab**: `invoke('read_dir', { path: 'projects/{id}/generated' })` (live tree)
- **Library tab**: Aggregated view across all directories
- **Plus button**: Opens "New Item" dialog (creates directory + initial file)
- **Click item**: Opens in respective panel

### 4C. SettingsModal (`src/App.tsx`)
**Current**: In-memory only.

**Realized**:
- All tweaks persisted to Tauri Store (`settings.json`)
- Style presets CRUD → `settings.json`
- Prompt templates CRUD → `settings.json`
- Accent colors, density, grid, etc. applied via CSS variables + Tailwind

### 4D. ScreensPanel (`src/panels/ScreensPanel.tsx`)
**Current**: Mock dashboard, fake chat, fake links.

**Realized**:
- **Chat**: Message history stored per screen in `projects/{id}/screens/{screenId}/chat.json`
- **Attachments**: Drag/drop/paste saves images to `.../attachments/`. Previews use `convertFileSrc` for Tauri paths.
- **Generate**: Calls `invoke('generate_completion', ...)` with prompt + attachments. Response streamed into chat. Generated code saved to `.../screen.tsx`.
- **Preview**: Renders actual generated component in iframe (`srcdoc` or `convertFileSrc` to local file). Hot-reloads on file change.
- **Device toggle**: CSS `transform: scale()` for tablet/mobile viewport simulation.
- **Link mode**: Click elements to define navigation links. Links stored in `screen.json`.
- **Zoom**: Actually zooms preview pane (CSS transform).
- **Export**: Calls `invoke('export_project', ...)`.

### 4E. ComponentsPanel (`src/panels/ComponentsPanel.tsx`)
**Current**: Mock login card, fake code, fake libraries.

**Realized**:
- **Prompt**: Stored per component in `.../prompt.json`
- **Generate**: Calls `invoke('generate_completion', ...)`. Code saved to `.../component.tsx`
- **Preview**: Renders actual generated component in iframe.
- **Code panel**: Reads file via `invoke('read_file')`. Editable in CM6. Save writes back via `invoke('write_file')`.
- **Libraries**: Stored in `.../generated/package.json`. Add/remove updates `package.json` and triggers `invoke('bun_install')`.
- **Theme picker**: Selects from `projects/{id}/themes/`
- **Save**: Adds to library index.
- **Export**: Calls `invoke('export_component')`.

### 4F. ThemesPanel (`src/panels/ThemesPanel.tsx`)
**Current**: Mock themes, fake CSS output.

**Realized**:
- **Prompt**: Stored per theme in `.../prompt.json`
- **Generate**: Calls `invoke('generate_completion', ...)` with theme prompt. CSS saved to `.../theme.css`
- **Preview**: Injects generated CSS into iframe for live preview.
- **Library**: Reads actual theme files.
- **CSS Output**: Reads `theme.css` via `invoke('read_file')`. Editable. Save writes back.
- **Framework toggle**: Adapts generation prompt (shadcn/daisy/bootstrap/generic).
- **Save as preset**: Adds to `settings.json` styles array.

### 4G. APIsPanel (`src/panels/APIsPanel.tsx`)
**Current**: Mock endpoints, fake auth, fake test.

**Realized**:
- **Saved APIs**: Stored as `.json` in `projects/{id}/apis/`
- **Import OpenAPI**: Parse YAML/JSON → generate API config via Rust (or frontend with `js-yaml`).
- **Paste cURL**: Parse cURL command → generate endpoint config.
- **New API**: Manual creation form.
- **Endpoints**: Parsed from API config. Click to edit.
- **Auth**: Stores scheme + credentials in API config. Supports Bearer, API key, Basic, OAuth2.
- **Schemas**: Displays from API config in CM6 (JSON/YAML mode).
- **Test**:
  - Input: Method + path + headers + body (CM6 editors)
  - Send: Calls `invoke('http_request', ...)`
  - Response: Real status, headers, body in CM6
  - History: Stores last 20 requests per endpoint

### 4H. RunnerPanel (`src/panels/RunnerPanel.tsx`) — **PRIORITY**
**Current**: Entirely mocked — fake terminal, fake file tree, fake preview.

**Realized**:
- **File tree**: Live `invoke('read_dir', { path: './generated' })`. Click file → open in editor.
- **Editor**: CM6 with actual file content. Editable. Auto-save on blur or `Ctrl+S`.
- **Terminal**:
  - `bun install`: `invoke('bun_install')`. Streams output.
  - `bun dev`: `invoke('bun_dev', { port: 5173 })`. Streams output. Preview detects readiness.
  - `bun build`: `invoke('bun_build')`. Streams output.
  - `stop`: `invoke('kill_process')`.
  - `new shell`: Generic bash in `./generated`.
  - Tabs: Terminal / Logs / Network
    - Terminal: Raw shell output
    - Logs: Parsed Vite HMR, build errors
    - Network: Requests made by preview (intercepted or logged)
- **Preview pane**:
  - Running: Load `http://localhost:5173` in iframe
  - Not running: Placeholder
  - Device frame: CSS transform
  - Refresh: Reload iframe
  - Fit: Resize iframe to panel

### 4I. LibraryPanel (`src/panels/LibraryPanel.tsx`)
**Current**: Static cards, no search, no actions.

**Realized**:
- **Tabs**: Components / Themes / Screens / APIs
- **Search**: Client-side filter by name/tag
- **Cards**: Real metadata + preview thumbnail (rendered component screenshot or gradient)
- **Actions**: Click to open, Edit (rename/delete), Duplicate, Export (zip)

### 4J. Workflows (`src/workflows/*.tsx`)
**Current**: Drag nodes, pan/zoom, fake execution.

**Realized**:
- **Canvas**: Keep existing drag/pan/zoom (pure frontend)
- **Palette**: Keep as-is
- **Saved workflows**: Stored in `projects/{id}/workflows/`
- **Save/Load**: Serialize/deserialize nodes + edges + properties to JSON
- **Execution**:
  - **Run button**: Actually executes the workflow graph topologically
  - **Node type → Rust command mapping**:
    - `input` → Read user prompt
    - `requirements` → `invoke('generate_completion')` to parse requirements
    - `designSystem` → Apply selected theme (frontend operation)
    - `architect` → `invoke('generate_completion')` to plan structure
    - `structure` → `invoke('generate_completion')` to generate HTML/JSX
    - `style` → `invoke('generate_completion')` to apply Tailwind classes
    - `interaction` → `invoke('generate_completion')` to add React hooks/state
    - `parallel` → Fork execution (Rust async)
    - `composition` → Merge outputs
    - `bash` → `invoke('run_shell_command')`
    - `fileop` → `invoke('read_file')` / `invoke('write_file')`
    - `bun` → `invoke('bun_dev')` / `invoke('bun_build')`
    - `fetch` → `invoke('http_request')`
    - `auth` → Apply auth headers to fetch
    - `transform` → Transform data (frontend or Rust)
    - `preview` → Render preview in panel
    - `validate` → Validate output (syntax check, type check)
  - **State**: Streaming text per node, green check on completion, red X on error
  - **Pause/Resume**: Track execution state, allow pausing between nodes

---

## Phase 5: Modals Realization

### 5A. ExportModal
- Collect all project files
- Generate framework-specific boilerplate (`package.json`, `tsconfig.json`, routing)
- Copy screens/components/themes/apis into correct directories
- Optionally generate Playwright/Vitest scaffolding
- **Zip via Rust** → Open native save dialog (`tauri-plugin-dialog`)

### 5B. ComponentExportModal
- Generate single-file component in chosen format (TSX, JSX, Vue, Svelte, Web Component)
- Optional: types, styles, Storybook, tests
- **Zip via Rust** → Save dialog

### 5C. SaveComponentModal
- Save metadata + code to `projects/{id}/components/`
- Scope: project-only (library scope copies to global templates dir)

### 5D. ProjectManagerModal
- Read `projects/` directory for list
- Create new: Create `projects/{newId}/project.json`
- Save current: Update `project.json`
- Load: Switch active project (all panels reload)
- Delete: Remove project directory recursively

### 5E. AddLibraryModal
- Validate npm package name (regex)
- Add to `projects/{id}/generated/package.json`
- Auto-run `invoke('bun_install')`

### 5F. PromptConfigModal
- Persist to `settings.json` via Tauri Store

---

## Phase 6: Prompt Inspector Realization

**Current**: Mocked tokens, fake endpoint, fake payloads.

**Realized**:
- **Assembled tab**: Shows actual prompt that WILL be sent. Real token count via `tiktoken` (Rust crate) or `gpt-tokenizer` (WASM).
- **JSON payload**: Shows exact JSON payload for the API call.
- **cURL tab**: Shows exact `curl` command.
- **Context bar**: Real token count vs. model context window.
- **Copy**: `tauri-plugin-clipboard`.
- **Images**: Actual base64 if attached.

---

## Phase 7: Build & Distribution

1. **Dev**: `bun tauri dev` — Vite dev server + Tauri window
2. **Build**: `bun tauri build` — Frontend bundle + Rust compile → platform binaries
3. **Outputs**:
   - Linux: `.deb`, `.AppImage`
   - macOS: `.dmg`, `.app`
   - Windows: `.msi`, `.exe`
4. **CI/CD**: GitHub Actions workflow from `tauri-ui` scaffold for automated releases

---

## Tauri v2 Setup Checklist

Before beginning implementation, verify:
- [ ] `cargo tauri info` shows Tauri v2 versions
- [ ] `src-tauri/capabilities/default.json` exists with at least `core:default`
- [ ] All commands registered in `generate_handler![]`
- [ ] `lib.rs` contains shared code (mobile-compatible)
- [ ] Required Rust targets installed: `rustup target add x86_64-unknown-linux-gnu` (and others as needed)
- [ ] `Cargo.toml` has `[lib]` section with `crate-type = ["staticlib", "cdylib", "rlib"]`
- [ ] `main.rs` is thin passthrough to `lib.rs::run()`
- [ ] Frontend imports from `@tauri-apps/api/core` (v2), NOT `@tauri-apps/api/tauri` (v1)

## Execution Order

**Track A (Foundation)** → Phases 0-1
- Scaffold, icons, theme, layout, CM6
- Can start immediately

**Track B (Backend)** → Phase 3
- Rust commands for shell/fs/http/ai
- Can start immediately (independent of Track A)

**Track C (Panels)** → Phases 4-6
Depends on Track A + B completion:
1. **Runner** (highest priority — requires shell + fs)
2. **Components** (requires ai + fs)
3. **Screens** (requires ai + fs + runner for preview)
4. **APIs** (requires http)
5. **Themes** (requires ai + fs)
6. **Workflows** (requires ai + shell + fs)
7. **Library** (requires fs)
8. **Settings / Modals** (requires store)

**Track D (Distribution)** → Phase 7
- Build config, CI/CD, signing
- Last phase

---

## Dependencies & Prerequisites

### System
- Rust toolchain (`rustc`, `cargo`)
- `rustup target add` for target platforms
- Bun runtime

### Rust Crates
- `tauri` v2
- `tauri-plugin-shell` v2
- `tauri-plugin-fs` v2
- `tauri-plugin-http` v2
- `tauri-plugin-store` v2
- `tauri-plugin-clipboard` v2
- `tauri-plugin-dialog` v2
- `tokio` (async runtime)
- `reqwest` or `tauri-plugin-http` (HTTP client)
- `serde`, `serde_json`
- `tiktoken-rs` or `gpt-tokenizer` (token counting)

### Frontend Packages
- `react` ^19, `react-dom` ^19
- `typescript`
- `vite`
- `tailwindcss` v4
- `shadcn/ui` (via CLI init)
- `lucide-react`
- `allotment`
- `@uiw/react-codemirror` + language packs
- `@tanstack/react-query`
- `zod`
- `js-yaml` (OpenAPI import parsing)

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tauri v2 API changes during migration | Low | High | Pin exact versions, check changelog before updates |
| shadcn/ui + Tailwind v4 integration issues | Low | Medium | Use `tauri-ui` scaffold which handles this |
| Ollama API differences from mock | Medium | Medium | Abstract AI provider interface, test with real Ollama instance |
| Bun process management cross-platform | Medium | High | Use `tauri-plugin-shell` which handles platform differences |
| CodeMirror 6 bundle size increase | Medium | Low | Tree-shake language packs, lazy-load themes |
| `allotment` SSR incompatibility | Low | High | Tauri is browser-only, no SSR concern |
| File system permissions on user machines | Medium | High | Request `fs:default` in capabilities, handle permission errors gracefully |

---

## Deep-Dive References

For detailed implementation guidance during execution, refer to these Tauri v2 skill resources:

| Topic | Resource |
|-------|----------|
| **Security & Permissions** | `references/capabilities-reference.md` — Permission patterns and examples |
| **IPC Decision Guide** | `references/ipc-patterns.md` — Complete IPC examples (commands, events, channels) |
| **Official Plugins** | `references/plugin-reference.md` — Install, registration, and permission strings for all plugins |
| **Updater & Distribution** | `references/updater-distribution-reference.md` — Signing, HTTPS requirements, bundle shipping |
| **Tray, Sidecars, Deep Links** | `references/advanced-runtime-reference.md` — `TrayIconBuilder`, sidecars, deep links, asset protocols |

**Official Docs**:
- [Tauri v2+ Documentation](https://v2.tauri.app/)
- [Commands Reference](https://v2.tauri.app/develop/calling-rust/)
- [Capabilities & Permissions](https://v2.tauri.app/security/capabilities/)
- [Configuration Reference](https://v2.tauri.app/reference/config/)

---

## Acceptance Criteria

- [ ] App launches as native desktop window (not browser tab)
- [ ] All 7 views accessible via header tabs
- [ ] Resizable panels with `allotment` sashes
- [ ] All icons are `lucide-react` (no inline SVGs)
- [ ] shadcn/ui primitives used for buttons, inputs, dialogs, badges
- [ ] CodeMirror 6 editors with syntax highlighting
- [ ] Runner panel spawns real `bun dev` process, shows live terminal output, loads preview in iframe
- [ ] Components panel generates real code via AI, saves to file system, renders preview
- [ ] Screens panel generates real screens via AI, supports chat history and attachments
- [ ] Themes panel generates real CSS themes via AI, previews live
- [ ] APIs panel makes real HTTP requests, shows real responses
- [ ] Workflows panel executes real node graphs with AI calls
- [ ] Library panel shows real project assets with search
- [ ] Project manager creates/loads/deletes real directory-based projects
- [ ] Export modal generates real zip files with save dialog
- [ ] Settings persist across app restarts
- [ ] All mocked data replaced with real functionality
- [ ] `bun tauri build` produces platform binaries
