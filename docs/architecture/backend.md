---
title: Backend Architecture
layout: default
permalink: /architecture/backend/
description: All 48 Rust commands grouped by function
---

# Backend Architecture

All Rust logic lives in `src-tauri/src/lib.rs`. Commands are registered in `generate_handler![]`; plugin permissions (e.g., `shell:default`, `fs:default`) are declared in `capabilities/default.json`. Missing either causes silent failure at runtime.

## Command groups (48 total)

### Process (10)

| Command | Purpose |
|---------|---------|
| `bun_dev` | Start a `bun dev` process for the active project |
| `bun_build` | Production build via `bun build` |
| `bun_install` | Async `bun install` |
| `bun_install_sync` | Synchronous `bun install` (blocks until complete) |
| `run_shell_command` | Generic async shell command |
| `run_shell_command_sync` | Synchronous shell command |
| `run_shell_command_capture` | Shell command with stdout/stderr capture |
| `kill_process` | Kill a specific process by PID |
| `kill_all_processes` | Kill all spawned processes |
| `kill_port` | Kill whatever is listening on a given port |

### File System (9)

| Command | Purpose |
|---------|---------|
| `read_dir` | List directory entries |
| `read_file` | Read a file by path |
| `write_file` | Write a file by path |
| `create_dir` | Create a directory |
| `delete_file` | Delete a file |
| `delete_dir` | Delete a directory |
| `rename_file` | Rename or move |
| `create_symlink` | Create a symlink |
| `reveal_in_explorer` | Open the OS file browser at a path |

### HTTP (3)

| Command | Purpose |
|---------|---------|
| `http_request` | Generic HTTP request (used by cloud AI providers) |
| `test_searxng_connection` | Verify a configured SearXNG instance is reachable |
| `setup_searxng_config` | Scaffold a local SearXNG `settings.yml` for the `web_search` agent tool |

### AI (10)

| Command | Purpose |
|---------|---------|
| `generate_completion` | One-shot completion (non-streaming) |
| `generate_completion_stream` | Streaming completion via Tauri Channel |
| `stop_generation_stream` | Cancel an in-flight stream |
| `resolve_tool_permission` | Resolve a pending `ToolPermission` event |
| `resolve_ask_user` | Resolve a pending `AskUser` event |
| `resolve_ask_user_form` | Resolve a pending `AskUserForm` event |
| `list_anthropic_models` | List models available from the configured Anthropic account |
| `list_ollama_models` | List models available on the local Ollama server |
| `save_model_presets` | Persist model presets |
| `load_model_presets` | Load saved model presets |

### Bonsai (11)

| Command | Purpose |
|---------|---------|
| `bonsai_start_server` | Start the local Bonsai image-generation server |
| `bonsai_stop_server` | Stop the Bonsai server |
| `bonsai_server_status` | Get current server state |
| `bonsai_generate_image` | Generate an image (streaming via Channel) |
| `bonsai_cancel_generation` | Cancel an in-flight generation |
| `bonsai_list_assets` | List saved assets |
| `bonsai_delete_asset` | Delete an asset |
| `bonsai_get_server_config` | Load server config |
| `bonsai_save_server_config` | Persist server config |
| `bonsai_schedule_stop` | Schedule a delayed server stop |
| `bonsai_cancel_stop` | Cancel a scheduled stop |

### Export (2)

| Command | Purpose |
|---------|---------|
| `export_project` | Export the whole project to a zip |
| `export_component` | Export a single component |

### Workflows (3)

| Command | Purpose |
|---------|---------|
| `save_workflow` | Persist a workflow graph |
| `load_workflow` | Load a workflow graph |
| `list_workflows` | List available workflows for the project |

## Layout

```
src-tauri/src/
  lib.rs                 # App setup, plugins, generate_handler![]
  main.rs                # Thin passthrough
  commands/
    process.rs           # Bun/shell spawning
    fs.rs                # File system
    http.rs              # HTTP client
    ai.rs                # Streaming completion, tool permissions, Anthropic models
    ai_providers.rs      # OpenAI/Claude providers
    ai_ollama.rs         # Ollama-specific logic
    export.rs            # Project/component export
    workflows.rs         # Workflow persistence
    mod.rs
  agent/                 # AI agent module (loop, executor, tools)
  sandbox/               # Linux sandbox (landlock + seccomp + bwrap)
```

## Adding a new command

Three steps:

1. Define the function in the appropriate `commands/*.rs` file with `#[tauri::command]`.
2. Register it in `generate_handler![]` in `lib.rs`.
3. If it needs a plugin (shell, fs, etc.), declare the permission in `capabilities/default.json`.

```rust
// src-tauri/src/commands/fs.rs
#[tauri::command]
pub async fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}
```

```rust
// src-tauri/src/lib.rs
#[tauri::generate_handler]
pub fn handler() {
    tauri::generate_handler![
        // ...
        commands::fs::read_file,
    ];
}
```

## What next

- [IPC]({{ '/architecture/ipc/' | relative_url }}) — `invoke` and `Channel` patterns
- [AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}) — the streaming protocol
- [Data Persistence]({{ '/architecture/data-persistence/' | relative_url }}) — where commands read/write
