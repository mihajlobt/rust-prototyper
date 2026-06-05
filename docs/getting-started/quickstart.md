---
title: Quickstart
layout: default
permalink: /getting-started/quickstart/
description: Run Prototyper for the first time
---

# Quickstart

From a fresh clone to a running app, and your first AI-generated screen, in under five minutes.

## Run the dev app

```bash
bun run tauri:dev
```

> On Wayland (CachyOS, etc.) always use `bun run tauri:dev`. The script auto-sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` which avoids WebKitGTK protocol error 71.

What this does:

1. Starts the Vite dev server on port `1420`.
2. Compiles and launches the Tauri shell.
3. Wires the two together — frontend talks to the Rust backend over IPC.

The first compile takes a couple of minutes; subsequent runs are seconds.

## First-run walkthrough

When the app opens, you'll see a 9-tab header (Wizard, Screens, Components, Design, Workflows, APIs, Runner, Library, Assets). A productive first run looks like this:

1. **Open the Wizard** — click the `Wizard` tab. This is the only panel that uses `ask_user`, so it's the friendliest way to drive the model step by step.
2. **Answer the first question** — the model will start with a short text or choice question (e.g. "What kind of app are you building?"). Type your answer and submit.
3. **Watch the live preview** — as the model generates code, the preview iframe updates via `postMessage({type:"reload"})` HMR.
4. **Annotate, if you want** — click points or drag regions on the preview to send spatial feedback back to the model.
5. **Switch to Runner** — the Runner tab shows the file tree, terminal (xterm.js), and live dev server. If the Wizard produced a scaffold, the dev server auto-starts.

## Try other panels

- **Screens** — chat + AI generation + device preview, with an embedded flow canvas
- **Components** — prompt → component code, live preview
- **Design (Themes)** — prompt → CSS theme, with the same preview
- **Workflows** — node-based graph execution (React Flow)
- **APIs** — HTTP request/response testing
- **Library** — searchable library of everything you've generated

## Build a production binary

```bash
bun tauri build
```

Outputs to `src-tauri/target/release/bundle/`:

- **Linux**: `.deb`, `.AppImage`
- **macOS**: `.dmg`, `.app`
- **Windows**: `.msi`, `.exe`

## What next

- [Project Structure]({{ '/getting-started/project-structure/' | relative_url }}) — where the code lives
- [Architecture → IPC]({{ '/architecture/ipc/' | relative_url }}) — how the frontend talks to the backend
- [Architecture → AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}) — the streaming pattern
