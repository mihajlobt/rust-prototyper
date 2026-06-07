---
title: Data Persistence
layout: default
permalink: /architecture/data-persistence/
description: Settings, project files, assets, workflows, and the store
---

# Data Persistence

Two mechanisms: `tauri-plugin-store` for app-level config, and the file system (via `read_file` / `write_file` IPC) for project content. No `localStorage` except for a one-time migration of legacy keys on first launch.

## The map

| Data | Mechanism | Location |
|------|-----------|----------|
| App settings | `tauri-plugin-store` | `settings.json` in app data dir |
| Project files | File system IPC (`read_file` / `write_file`) | `projects/{projectId}/` under app data |
| Assets | File system + sidecar JSON | `projects/{projectId}/assets/` |
| Bonsai config | `tauri-plugin-store` | `bonsai_config.json` in app data dir |
| Workflows | `save_workflow` / `load_workflow` Rust commands | Per-project workflow directory |
| Model presets | `save_model_presets` / `load_model_presets` | App data dir |
| Pane sizes | `useAllotmentLayout` hook | Tauri Store |
| Chat history | File system IPC, written by `useChat` | `{entity}/chat.json` next to the entity (e.g. `projects/{id}/plans/{slug}.chat.json`, `projects/{id}/themes/{dir}/chat.json`) |

## App-level config: Tauri Store

Two stores live in the app data dir:

- `settings.json` — theme, accent, model picker, AI keys, layout
- `bonsai_config.json` — Bonsai image server config

Frontend access goes through `useSettings`:

```typescript
import { useSettings } from '@/hooks/useSettings';

const { settings, updateSetting } = useSettings();
await updateSetting('theme', 'dark');
```

`useSettings` is a thin re-export over `tauri-plugin-store`'s API. There is no fallback to `localStorage` — keys persist in the store file across launches.

## Project files: filesystem IPC

Project content lives under `projects/{projectId}/` in the app data dir. The frontend never reads or writes this directly; it goes through `read_file` / `write_file`:

```typescript
// src/lib/ipc.ts
export async function readFile(path: string): Promise<string> {
  return invoke('read_file', { path });
}

export async function writeFile(path: string, contents: string): Promise<void> {
  return invoke('write_file', { path, contents });
}
```

React Query wraps these for caching and invalidation (`useProjectFiles`). Project mutations invalidate the affected query keys so the UI re-fetches.

## Assets: filesystem + sidecar JSON

Generated images (Bonsai) are stored under `projects/{projectId}/assets/`. Each image has a sidecar `.json` file with metadata (prompt, model, seed, dimensions, creation time).

```
projects/{projectId}/assets/
  a1b2c3d4.png
  a1b2c3d4.json    # sidecar metadata
  e5f6g7h8.png
  e5f6g7h8.json
```

The sidecar is the source of truth for asset metadata — never infer it from the image filename.

## Workflows: per-project dir

Workflows are persisted via `save_workflow` / `load_workflow` Rust commands. Each workflow lives in its own subdirectory under the project's workflow dir, with the React Flow graph JSON as the canonical artifact.

## Model presets

Saved via `save_model_presets` / `load_model_presets` (file system, app data dir). Each preset is `{ provider, model, host?, apiKey? }`. Cloud API keys live in presets — not in `settings.json`.

## Pane sizes

`useAllotmentLayout` persists Allotment pane sizes via the Tauri Store, not a separate file. On mount, `defaultSizes` is restored from the stored value. On drag end, `onDragEnd` writes the new sizes.

## Chat history

`useChat` takes a required `chatPath` and persists every message to disk as JSON via `read_file` / `write_file` — it is **not** ephemeral. Each panel derives its own path next to the entity it's chatting about:

| Panel | `chatPath` |
|-------|------------|
| Plans | `projects/{id}/plans/{slug}.chat.json` |
| Themes | `projects/{id}/themes/{dir}/chat.json` |
| Screens | derived from `screenId` |
| Components | derived from `componentId` |

`chatStore` (Zustand) holds the in-memory streaming state for the active session; `chatPath` is what survives an app restart.

## What is NOT persisted

- **Per-panel UI state** (open/closed sections, selected tabs) — resets each launch.
- **Preview annotations (Wizard)** — ephemeral by design. The shared `AnnotationOverlay` is wired on both the live preview iframe and the Design tab.

## What next

- [Backend]({{ '/architecture/backend/' | relative_url }}) — the file system commands (`read_file`, `write_file`, `create_dir`, ...)
- [AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}) — channels for transient data
