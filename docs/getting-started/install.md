---
title: Install
layout: default
permalink: /getting-started/install/
description: Install prerequisites and dependencies for Prototyper
---

# Install

What you need before you can run Prototyper locally. Five things: a package manager, a Rust toolchain, Tauri system libraries, optionally a local AI model, and the project itself.

## Prerequisites

- **[Bun](https://bun.sh/)** — package manager and JS runtime (any recent version).
- **[Rust](https://rustup.rs/)** — `rustc` + `cargo` (stable toolchain, edition 2021).
- **Linux system dependencies** — at minimum `libwebkit2gtk-4.1-dev` and `libappindicator3-dev`. See the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for the full per-distro list.
- **[Ollama](https://ollama.com)** *(optional)* — local AI provider running on `http://localhost:11434`.
- **OpenAI or Anthropic API key** *(optional)* — for cloud AI providers.

## Install dependencies

```bash
bun install
```

This installs all frontend dependencies. The Rust toolchain is managed by `rustup`; you don't need to install anything extra for the backend beyond `cargo`.

## Verify

```bash
bun --version    # any recent Bun
cargo --version  # stable Rust
```

If `cargo` is missing, install via [rustup](https://rustup.rs/). Bun installs with the one-liner on its homepage.

## Optional: Ollama setup

If you want to use a local model:

```bash
# Install Ollama from https://ollama.com
ollama serve                 # start the local server (default :11434)
ollama pull qwen2.5-coder    # or any other model
```

Then in the app, open **Settings → AI** and pick the local Ollama host. The model list auto-populates via the `list_ollama_models` Rust command.

## Optional: cloud providers

For OpenAI or Claude, drop your API key into **Settings → AI → API Key**. Keys are stored in `settings.json` via `tauri-plugin-store` and never sent anywhere except the configured provider.

## What next

- [Quickstart]({{ '/getting-started/quickstart/' | relative_url }}) — run the app, open the Wizard
- [Project Structure]({{ '/getting-started/project-structure/' | relative_url }}) — what lives where
- [Troubleshooting]({{ '/getting-started/troubleshooting/' | relative_url }}) — common pitfalls
