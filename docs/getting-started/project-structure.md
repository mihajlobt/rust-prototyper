---
title: Project Structure
layout: default
permalink: /getting-started/project-structure/
description: Where the frontend, backend, hooks, and Rust commands live
---

# Project Structure

A short map of the repo. The full layout is in `README.md`; this page is the 60-second orientation.

## Top-level

```
Prototyper/
├── src/                  # React 19 frontend (Vite, port 1420)
├── src-tauri/            # Rust backend (Tauri v2)
├── docs/                 # This Jekyll site (Cloudflare Pages)
├── thoughts/             # Architecture plans, research, prompts (not built)
├── .opencode/context/    # AI context library (auto-copied into docs/_context/)
├── CLAUDE.md             # Quick-reference architecture guide for AI assistants
├── README.md             # Full install, run, build, and reference
├── DESIGN.md             # Design language (Quiet Instrument)
└── coding-standards.md   # File size, naming, types, styling, Allotment rules
```

## Frontend (`src/`)

```
src/
  App.tsx                  # App shell — allotment layout, view routing, dark/accent theming
  main.tsx                 # React entry point
  layout/                  # Header (9 tabs + model picker + project + settings) + SidebarRail
  panels/                  # 9 panels — Wizard, Screens, Components, Themes, APIs, Runner, Library, Assets
  workflows/               # WorkflowsView — React Flow graph execution engine
  hooks/                   # useSettings, useChat, useBonsai, useProjectFiles, useAllotmentLayout, ...
  lib/
    ipc.ts                 # Single source of truth for Rust↔TS calls (invoke wrappers)
    stream-channel.ts      # Tauri Channel → AsyncIterable bridge
    scaffold.ts            # Scaffolding core
    prompts/               # Prompt templates per domain (screens, components, themes, ...)
  modals/                  # SettingsModal, ProjectManagerModal, ExportModal, ...
  components/
    ui/                    # ~50 shadcn primitives + 20 domain components (70 total)
    chat/                  # ChatInput, MessageList, MentionPicker, ...
  stores/                  # Zustand: appStore, chatStore, projectSettingsStore, bonsaiStore, uiStore
  styles/globals.css       # Tailwind v4 @theme inline block + CSS custom properties
```

The `lib/ipc.ts` file is the **only** place `invoke()` is wrapped. Every Rust command call goes through it. If you find yourself writing `invoke('foo', ...)` anywhere else, put it in `ipc.ts`.

## Backend (`src-tauri/`)

```
src-tauri/
  src/
    lib.rs                 # App setup, plugins, generate_handler![] (44 commands)
    main.rs                # Thin passthrough to lib.rs
    commands/
      process.rs           # Bun/shell spawning, kill
      fs.rs                # File system CRUD + symlink + reveal
      http.rs              # HTTP client
      ai.rs                # Streaming completion, tool permissions
      ai_providers.rs      # OpenAI/Claude provider implementations
      ai_ollama.rs         # Ollama-specific logic + model listing + presets
      export.rs            # Project/component export
      workflows.rs         # Workflow persistence
      mod.rs
    agent/                 # AI agent module (loop, executor, tools)
    sandbox/               # Linux sandbox (landlock + seccomp + bwrap)
  capabilities/default.json  # Tauri plugin permissions
  tauri.conf.json            # Window config (1400×900), CSP, devUrl (port 1420)
  Cargo.toml                 # Rust dependencies
```

Every Tauri command lives in `lib.rs`'s `generate_handler![]` macro. The list of all 44 commands is in [Backend]({{ '/architecture/backend/' | relative_url }}).

## Docs (`docs/`)

```
docs/
  _config.yml              # Jekyll 4.3 + kramdown; Cloudflare Pages url
  _data/navigation.yml     # Sidebar data (rendered by sidebar.html)
  _includes/sidebar.html   # Renders navigation
  _layouts/default.html    # Header, sidebar, main, footer
  assets/css/site.css      # All styling
  build.sh                 # Copies .opencode/context/ → _context/, then jekyll build
  index.md                 # Landing
  getting-started/         # 5 files (this section)
  architecture/            # 10 files (4 existing + 6 new)
  standards/               # 4 files (coding, design, context-system, index)
  plans/                   # 2 existing files
  specs/                   # 1 existing file
  _context/                # Generated from .opencode/context/ (excluded from git, generated on build)
```

The `_context/` directory is **regenerated every build** from `.opencode/context/`. Don't edit it directly.

## What next

- [Architecture → Frontend]({{ '/architecture/frontend/' | relative_url }}) — panels, hooks, state
- [Architecture → Backend]({{ '/architecture/backend/' | relative_url }}) — all 44 commands
- [Architecture → Data Persistence]({{ '/architecture/data-persistence/' | relative_url }}) — where data lives
