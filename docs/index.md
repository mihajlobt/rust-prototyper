---
title: Home
layout: default
permalink: /
description: Internal documentation for the Prototyper Tauri v2 desktop app
---

# Prototyper

AI-powered UI prototyping desktop app. Built with **Tauri v2** (Rust backend) + **React 19** + **TypeScript** frontend. Connects to local Ollama, Ollama Cloud, OpenAI, and Claude for code generation, and spawns real `bun dev` processes for live preview.

This site holds the **internal architecture, standards, plans, and specs** for the project. For install, run, and build instructions see the [README](https://github.com/mihajlobt/rust-prototyper#readme) on GitHub.

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Shell | Tauri v2 | `2` |
| Frontend | React | `^19.1.0` |
| Language | TypeScript | `~5.8.3` |
| Build | Vite | `^7.0.4` |
| Styling | Tailwind CSS | `^4.2.4` |
| UI Kit | shadcn/ui (radix-ui) | `radix-ui ^1.4.3` |
| Layout | allotment | `^1.20.5` |
| Editor | CodeMirror 6 (`@uiw/react-codemirror`) | `^4.25.9` |
| Icons | lucide-react | `^1.11.0` |
| State | Zustand | `^5.0.12` |
| Data fetching | TanStack React Query | `^5.100.1` |
| Graph | React Flow (`@xyflow/react`) | `^12.10.2` |
| Terminal | xterm.js (`@xterm/xterm`) | `^6.0.0` |
| Runtime | Bun | any recent |
| Backend | Rust (edition 2021) | — |
| AI | Ollama (`ollama-rs`) + OpenAI + Claude via `reqwest` | `0.3` |

## Where to go next

<div class="card-grid">
  <a class="card" href="{{ '/getting-started/' | relative_url }}">
    <div class="card-title">Getting Started</div>
    <div class="card-body">Install, run, project layout, and the most common pitfalls.</div>
  </a>
  <a class="card" href="{{ '/architecture/' | relative_url }}">
    <div class="card-title">Architecture</div>
    <div class="card-body">Frontend, backend, IPC, data persistence, and AI streaming internals.</div>
  </a>
  <a class="card" href="{{ '/standards/' | relative_url }}">
    <div class="card-title">Standards</div>
    <div class="card-body">Coding rules, design language, and the context system that organizes the project.</div>
  </a>
  <a class="card" href="{{ '/context/navigation/' | relative_url }}">
    <div class="card-title">Context</div>
    <div class="card-body">The full 95-file AI context library auto-copied from <code>.opencode/context/</code>.</div>
  </a>
</div>

---

Last build: `{{ site.time | date: "%Y-%m-%d %H:%M:%S %Z" }}`
