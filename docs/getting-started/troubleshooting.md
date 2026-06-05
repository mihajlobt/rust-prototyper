---
title: Troubleshooting
layout: default
permalink: /getting-started/troubleshooting/
description: Common pitfalls and their fixes
---

# Troubleshooting

The five issues that show up the most often, taken from `CLAUDE.md`'s "Common pitfalls" section. Each one names the symptom, the cause, and the fix.

## White screen on launch

**Cause**: Vite is on a different port than `devUrl` expects.

**Fix**: `devUrl` in `src-tauri/tauri.conf.json` must match Vite's port (`1420`). If you change Vite's port, change `devUrl` to match.

## Wayland crash (protocol error 71)

**Symptom**: The Tauri window opens and then immediately dies with a WebKitGTK protocol error.

**Fix**: Use `bun run tauri:dev`, not `bun tauri dev`. The `tauri:dev` script sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` automatically. On Wayland distros (CachyOS, Fedora Silverblue, etc.) this is required.

## Command not found at runtime

**Symptom**: `invoke('some_command', ...)` rejects with a "command not found" error.

**Fix**: Two things must be true for a Tauri command to work:

1. The Rust function is registered in `generate_handler![]` in `lib.rs`.
2. The corresponding plugin permission (e.g. `shell:default`, `fs:default`) is declared in `capabilities/default.json`.

Missing either one causes **silent failure** — no compile error, no panic, just an undefined command at runtime.

## Tauri v1 vs v2 imports

**Fix**: Always import from `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`. The v1 path still works in some bundles but is the wrong path for v2 and breaks in subtle ways.

```typescript
// Correct (v2)
import { invoke, Channel } from '@tauri-apps/api/core';

// Wrong (v1, breaks on v2)
import { invoke } from '@tauri-apps/api/tauri';
```

## IPC timeout on heavy operations

**Symptom**: The frontend `await invoke(...)` never resolves; the backend thread is blocked.

**Fix**: Never block an async Tauri command. Wrap heavy work in `tokio::spawn(...)` so the command returns immediately and the work runs in the background. Long-running operations (model downloads, scaffolding, big file copies) all need this pattern.

## Radix UI `ContextMenu` is uncontrolled

**Symptom**: Trying to drive a right-click menu from React state doesn't work — `open` / `onOpenChange` props are silently ignored.

**Fix**: `ContextMenu.Root` in radix-ui is uncontrolled only; it does not accept an `open` prop. For controlled right-click menus, use `DropdownMenu.Root` with `open` / `onOpenChange` instead. The visual difference is minimal but the controlled behavior is reliable.

## Allotment `resize()` crashes

**Symptom**: `TypeError: undefined is not an object (evaluating 'pane.minimumSize')` from inside an effect or animation frame.

**Fix**: `resize()` is only safe in event handlers (click, drag). Never call it in `useEffect` or `requestAnimationFrame`. For collapse/expand patterns, use the declarative `visible` prop on `Allotment.Pane` — see [coding standards]({{ '/standards/coding/' | relative_url }}) for the full pattern.

## What next

- [Coding Standards]({{ '/standards/coding/' | relative_url }}) — the rules behind the fixes
- [Architecture → IPC]({{ '/architecture/ipc/' | relative_url }}) — how invoke and Channel work
