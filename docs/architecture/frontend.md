---
title: Frontend Architecture
layout: default
permalink: /architecture/frontend/
description: React 19 + Vite, panel structure, hooks, and state
---

# Frontend Architecture

React 19 + TypeScript + Vite, organized around 9 panels, a small set of cross-cutting hooks, and Zustand stores. All data flows through `src/lib/ipc.ts` — the single source of truth for Rust calls.

## App shell

`App.tsx` is the shell. It owns:

- the **allotment layout** (resizable panes) and pane-size persistence
- **view routing** between the 9 panels
- **dark / accent theming** via CSS custom properties

`main.tsx` is the React entry point — no logic.

```text
Header (44-48px) → Project tree (left) | Active view
```

The body uses Allotment-style resizable splits with 1px gutters. Canvas views (Workflows, Flows) pan/zoom on a dotted grid; generation views (Screens, Components, Design) put the chat left and the preview right.

## 9 panels

| View | Component | Purpose |
|------|-----------|---------|
| Wizard | `WizardPanel` | Full-app generator with `ask_user` Q&A, live preview, shared `AnnotationOverlay` (also wired on the Design tab), floating `Tokens \| Gallery` toggle in the Design-tab preview |
| Screens | `ScreensPanel` | Chat + AI generation + device preview (embeds flow canvas) |
| Components | `ComponentsPanel` | Prompt → component code + live preview |
| Design (Themes) | `ThemesPanel` | Prompt → CSS theme generation |
| Workflows | `WorkflowsView` | Node-based execution canvas (React Flow) |
| APIs | `APIsPanel` | HTTP request/response testing |
| Runner | `RunnerPanel` | File tree, terminal (xterm.js), live preview |
| Library | `LibraryPanel` | Searchable library of components, themes, screens, workflows, APIs |
| Assets | `AssetsPanel` | AI image generation (Bonsai), asset gallery |

The Wizard is the only panel that uses `ask_user` — it's a thin panel-level wrapper over `useChat` with four optional callbacks (`onAskUser`, `onAskUserForm`, `onToolCall`, `onToolResult`).

## Cross-cutting hooks

```
src/hooks/
  useSettings.ts              # Tauri Store persistence (thin re-export)
  useChat.ts                   # Chat session + streaming — used by all panel-level UIs
  useProjectFiles.ts          # Project file operations + React Query keys
  useModelCapabilities.ts     # Model capability detection (vision, tools, etc.)
  useAllotmentLayout.ts       # Pane size persistence
  useToast.ts                  # Toast notifications
  useBonsai.ts                 # Bonsai server + asset gallery lifecycle
  useScreenCode.ts             # Screen code save/load
  useHotspotTracking.ts        # Underlying hotspot/region tracker (consumed by the shared AnnotationOverlay in src/components/ui/AnnotationOverlay.tsx)
  use-mobile.ts                # Mobile breakpoint detection
```

`useChat` is the heaviest hook. It wraps the streaming `Channel<CompletionEvent>` and exposes callbacks for the 8 event variants. The Wizard subscribes to all of them; simpler panels subscribe to a subset.

## State

Five Zustand stores, each with a clear domain:

| Store | What it holds |
|-------|---------------|
| `appStore` | Global app settings (theme, accent, model picker) |
| `chatStore` | Chat state (messages, streaming status) |
| `projectSettingsStore` | Per-project settings |
| `bonsaiStore` | Bonsai server state + asset gallery |
| `uiStore` | UI state (panel visibility, layout) |

Stays out of stores: derived data (use `useMemo` or selectors) and component-local state (`useState`).

## The IPC single-source-of-truth

`src/lib/ipc.ts` wraps **every** `invoke()` call. If you find yourself writing `invoke('foo', ...)` anywhere else, move it to `ipc.ts`.

```typescript
// src/lib/ipc.ts
import { invoke } from '@tauri-apps/api/core';
import type { CompletionEvent, ModelPreset, ... } from './types';

export async function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string,
  onEvent: (event: CompletionEvent) => void,
): Promise<void> {
  return invoke('generate_completion_stream', { model, messages, host, apiKey, onEvent });
}
```

Components import the wrapper, not `invoke`. This gives one place to add logging, error handling, type checking, and migration shims.

## Styling

Tailwind v4 + shadcn/ui. Tokens in `src/styles/globals.css` (`@theme inline` block). All domain-specific CSS lives in `globals.css`. The shell is greyscale; color is reserved for node types, run status, and the user's generated output (see [Design Language]({{ '/standards/design/' | relative_url }}) for the full token system).

## Package manager

**Always `bun` and `bunx`** — never `npm`, `npx`, or `yarn`:

```bash
bun install          # install deps
bun add <pkg>        # add package
bunx shadcn@latest   # run package binaries
bunx tsc --noEmit    # type-check
```

## What next

- [Backend]({{ '/architecture/backend/' | relative_url }}) — Rust commands grouped by function
- [IPC]({{ '/architecture/ipc/' | relative_url }}) — `invoke` and `Channel` patterns
- [Data Persistence]({{ '/architecture/data-persistence/' | relative_url }}) — where data lives
