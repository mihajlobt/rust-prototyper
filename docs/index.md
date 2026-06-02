---
title: Home
layout: default
---

# Prototyper

AI-powered UI prototyping desktop app. Built with **Tauri v2** (Rust backend) + **React 19** + **TypeScript** frontend. Connects to local Ollama, Ollama Cloud, OpenAI, and Claude for code generation, and spawns real `bun dev` processes for live preview.

## What's in these docs

This site holds the **internal architecture, plans, and specs** for the project. For general usage docs (install, run, build) see the [README](https://github.com/mihajlobt/rust-prototyper#readme) on GitHub.

### Architecture

- [Chat Stream & Tool Flow]({{ '/architecture/chat-flow/' | relative_url }}) — Mermaid sequence diagram of the streaming chat + tool-call flow
- [Tool Permission System]({{ '/architecture/tool-permission-architecture/' | relative_url }}) — Cursor-style accept/reject cards for agent tool calls
- [Open Agent SDK Analysis]({{ '/architecture/open-agent-sdk-analysis/' | relative_url }}) — Feasibility audit of `open-agent-sdk` v0.6.4 as a drop-in replacement

### Plans

- [Native Context Menu]({{ '/plans/context-menu/' | relative_url }}) — Replace shadcn `ContextMenu` with Tauri v2 native menu in Runner panel
- [Shared Chat]({{ '/plans/shared-chat/' | relative_url }}) — Cross-panel chat state plan

### Specs

- [Shared Chat Design]({{ '/specs/shared-chat-design/' | relative_url }}) — Detailed design spec for the shared chat feature

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Shell | Tauri v2 |
| Frontend | React 19 + TypeScript |
| Build | Vite |
| Styling | Tailwind CSS v4 + shadcn/ui |
| Backend | Rust (Tokio async) |
| AI | Ollama, OpenAI, Claude |
| Runtime | Bun |

See the [GitHub repo](https://github.com/mihajlobt/rust-prototyper) for full tech-stack details.
