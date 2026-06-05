---
title: Getting Started
layout: default
permalink: /getting-started/
description: Install, run, and explore the Prototyper project
---

# Getting Started

Five short pages that take you from a fresh clone to a running app, with the file layout, the first-run experience, and the most common pitfalls along the way.

## Pages

<div class="card-grid">
  <a class="card" href="{{ '/getting-started/install/' | relative_url }}">
    <div class="card-title">Install</div>
    <div class="card-body">Prerequisites, system dependencies, and the install command.</div>
  </a>
  <a class="card" href="{{ '/getting-started/quickstart/' | relative_url }}">
    <div class="card-title">Quickstart</div>
    <div class="card-body">Run the app, open the Wizard, generate a first screen.</div>
  </a>
  <a class="card" href="{{ '/getting-started/project-structure/' | relative_url }}">
    <div class="card-title">Project Structure</div>
    <div class="card-body">Where frontend, backend, hooks, modals, and Rust commands live.</div>
  </a>
  <a class="card" href="{{ '/getting-started/troubleshooting/' | relative_url }}">
    <div class="card-title">Troubleshooting</div>
    <div class="card-body">The five most common pitfalls with the actual fixes.</div>
  </a>
</div>

## What you'll need in 30 seconds

- **Bun** (any recent) — package manager and JS runtime
- **Rust** (`rustc` + `cargo`) — backend toolchain
- **Linux deps**: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, etc. (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))
- **Ollama** (optional, default `http://localhost:11434`) for local AI
- **OpenAI / Anthropic API key** (optional) for cloud providers

Then:

```bash
bun install
bun run tauri:dev
```

See [Install]({{ '/getting-started/install/' | relative_url }}) for the full prerequisites and [Troubleshooting]({{ '/getting-started/troubleshooting/' | relative_url }}) if anything goes wrong.
