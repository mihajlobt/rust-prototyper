---
title: Architecture Overview
layout: default
permalink: /architecture/
description: Frontend, backend, IPC, data persistence, and AI streaming
---

# Architecture Overview

Two processes, one IPC channel, four AI providers, and one stateful per-project file tree. The shape of the system at a glance.

## System diagram

```mermaid
flowchart LR
    subgraph Frontend
        UI[React 19 + Vite<br/>port 1420]
        Hooks[hooks/<br/>useChat, useSettings, useBonsai, ...]
        Stores[Zustand stores<br/>app, askUser, bonsai, chat, projectSettings, ui]
        UI --> Hooks
        UI --> Stores
    end

    subgraph Backend
        Rust[Rust commands<br/>48 in lib.rs]
        Agent[agent/ module<br/>loop, executor, tools]
        Sandbox[sandbox/<br/>landlock + seccomp + bwrap]
        Rust --> Agent
        Agent --> Sandbox
    end

    subgraph AI_Providers
        OllamaLocal[Ollama local<br/>localhost:11434]
        OllamaCloud[Ollama Cloud<br/>ollama.com]
        OpenAI[OpenAI<br/>api.openai.com]
        Claude[Claude<br/>api.anthropic.com]
    end

    FS[(Filesystem<br/>app data dir<br/>projects/&lt;id&gt;/<br/>assets/)]
    Store[(Tauri Store<br/>settings.json<br/>bonsai_config.json)]

    UI <-->|invoke + Channel| Rust
    Rust -->|HTTP| OllamaLocal
    Rust -->|HTTP| OllamaCloud
    Rust -->|HTTP| OpenAI
    Rust -->|HTTP| Claude
    Rust <--> FS
    Rust <--> Store
```

The frontend never talks to AI providers directly — every request flows through a Rust command. The Rust side owns the streaming channel, tool permission resolution, and `ask_user` / `ask_user_form` round-trips.

## Sections

- **[Frontend]({{ '/architecture/frontend/' | relative_url }})** — React 19 + Vite, panel structure, hooks, state
- **[Backend]({{ '/architecture/backend/' | relative_url }})** — all 48 Rust commands by group
- **[IPC]({{ '/architecture/ipc/' | relative_url }})** — Tauri `invoke` and `Channel` patterns
- **[Data Persistence]({{ '/architecture/data-persistence/' | relative_url }})** — settings, projects, assets, workflows
- **[AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }})** — the 8-variant `CompletionEvent` enum

## Existing deep-dive reports

- **[Chat Stream & Tool Flow]({{ '/architecture/chat-flow/' | relative_url }})** — Mermaid sequence diagram with source references
- **[Tool Permission System]({{ '/architecture/tool-permission-architecture/' | relative_url }})** — Cursor-style accept/reject cards
- **[Open Agent SDK Analysis]({{ '/architecture/open-agent-sdk-analysis/' | relative_url }})** — feasibility audit of `open-agent-sdk` v0.6.4
