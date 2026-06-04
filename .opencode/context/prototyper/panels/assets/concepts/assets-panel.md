<!-- Context: prototyper/panels/assets/concepts/assets-panel | Priority: high | Version: 1.1 | Updated: 2026-06-04 -->

# Assets Panel Architecture

> Image generation panel for the Prototyper app. Wraps a local Bonsai (mflux) Python server and manages generated assets per-project.

## Panel Structure

```
AssetsPanel.tsx
├── Toolbar (start/stop server, auto-stop, config, log toggle)
├── Error banner (bonsai.error)
└── Allotment split (useAllotmentLayout "assets", 2 panes)
    ├── Left: generation form + scrollable gallery
    │   ├── Prompt textarea + generate/stop button
    │   ├── Size preset chips (multiples of 32)
    │   ├── Steps slider + seed input
    │   └── AssetGrid (grid or list view)
    └── Right: Bonsai server log (XTerminal)
```

**Code**: `src/panels/AssetsPanel.tsx`

## Data Flow

```
React UI
  ├── useBonsai() hook — binds store to current project
  ├── useBonsaiStore (Zustand) — serverStatus, assets[], generating, error
  └── useProjectSettingsStore — per-project UI state (viewMode, showLog, sortOrder)
        ↓ IPC invoke
Rust backend (src-tauri/src/commands/bonsai_assets.rs, bonsai.rs)
  ├── bonsai_generate_image → HTTP POST /generate → raw PNG bytes
  ├── bonsai_list_assets / bonsai_delete_asset → filesystem
  └── bonsai_start_server / bonsai_stop_server → tokio::process::Command
        ↓ HTTP (localhost)
Bonsai FastAPI server (Python uvicorn)
  └── /generate returns raw PNG
```

**Key rule**: The `useBonsai` hook is the single integration point. It loads config, refreshes status, and lists assets whenever the active project changes.

## Sidecar Metadata Pattern

Every generated image writes two files:

```
projects/{projectId}/assets/
├── bonsai_{timestamp}_{seed}.png
└── bonsai_{timestamp}_{seed}.json   ← sidecar metadata
```

The JSON (`BonsaiAssetMeta`) stores:
- `prompt`, `width`, `height`, `steps`, `seed`, `variant`

**Why**: PNGs don't embed generation params. The sidecar lets the gallery show prompts and enables "copy prompt" in the context menu. `bonsai_list_assets` reads the JSON and populates `AssetInfo.prompt`.

**Code**: `src-tauri/src/commands/bonsai_assets.rs` — `BonsaiAssetMeta`, `bonsai_list_assets`

## Image Generation

```rust
// Rust: bonsai_generate_image
let request = http_client
    .post("http://127.0.0.1:{port}/generate")
    .json(&body)
    .timeout(Duration::from_secs(300))  // 5 min — model loading is slow
    .send();
```

- Returns **raw PNG bytes**, not a JSON wrapper.
- File naming: `bonsai_{timestamp}_{seed}.png`
- Saved to `projects/{projectId}/assets/`

## Cancellation

Uses `tokio_util::sync::CancellationToken` raced with the HTTP request:

```rust
tokio::select! {
    result = request => { /* handle response */ }
    _ = cancel_token.cancelled() => {
        return Err(bonsai_error("Image generation was cancelled"));
    }
}
```

- `bonsai_cancel_generation` signals the token.
- Dropping the HTTP connection aborts server-side work.
- Only one generation runs at a time; a second request is rejected with "already in progress".

**Code**: `src-tauri/src/commands/bonsai_assets.rs` — `bonsai_generate_image`, `bonsai_cancel_generation`

## Server Lifecycle

```
Start (bonsai_start_server)
  ├── Kill stale processes / ports 8000-8005
  ├── Spawn uvicorn (process_group(0) on Unix for clean GPU cleanup)
  ├── Stream stdout/stderr → "bonsai:log" Tauri events
  └── Health-check loop (/backends) up to 120s
        → Healthy: store BonsaiServer in AppState
        → Unhealthy: kill child, return error

Auto-stop (bonsai_schedule_stop)
  ├── Tokio task sleeps for configured timeout (default 60s)
  └── Emits "bonsai:stop-timeout" → frontend calls bonsai_stop_server

Manual stop (bonsai_stop_server)
  ├── Abort auto-stop timer if present
  ├── kill_process_group(pid) — SIGTERM, wait 2s, SIGKILL
  ├── child.kill() fallback
  └── kill_port_sync(port) cleanup
```

**Code**: `src-tauri/src/commands/bonsai.rs` — `bonsai_start_server`, `bonsai_stop_server`, `bonsai_schedule_stop`

## File Locations

Assets are scoped per-project under the Tauri app data directory:

```
{app_data_dir}/projects/{projectId}/assets/
```

All paths are constructed via `resolve_path(app, "projects/{id}/assets")` with traversal guards (`..`, absolute paths rejected).

**Code**: `src-tauri/src/commands/bonsai_assets.rs` — `bonsai_list_assets`, `bonsai_delete_asset`

## Related

- **UI patterns** → `assets-ui-patterns.md`
- **Bonsai backend integration** → `bonsai-backend.md`
- **Frontend store** → `src/stores/bonsaiStore.ts`
- **IPC types** → `src/lib/bonsai.ts`
