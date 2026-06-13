<!-- Context: prototyper/navigation | Priority: critical | Version: 1.0 | Updated: 2026-06-04 -->

# Prototyper Project Context

**Purpose**: Architecture, patterns, and quick reference for the Prototyper Tauri v2 desktop app (React 19 + TypeScript frontend, Rust backend) for AI-assisted UI prototyping.

**New here?** → Read this file top to bottom, then `project-intelligence/domain.md` and `project-intelligence/processes.md`.

---

## Architecture at a Glance

```
Frontend (React 19 + Vite, port 1420) ←IPC→ Rust backend (Tauri v2)
```

- **All Rust logic** lives in `src-tauri/src/lib.rs` (44 commands, see [Rust commands lookup](#rust-commands))
- **All IPC** goes through `src/lib/ipc.ts` (single source of truth for `invoke()` calls)
- **AI streaming** uses Tauri Channel IPC with 8-variant `CompletionEvent` enum
- **Data persistence**: `tauri-plugin-store` for settings, raw filesystem for project files/assets/workflows
- **No `localStorage`** except one-time migration of legacy keys on first launch

---

## Structure

```
.opencode/context/prototyper/
├── navigation.md                  # This file
│
├── panels/                        # mirrors src/panels/
│   └── assets/
│       ├── concepts/
│       │   └── assets-panel.md    # AssetsPanel architecture, data flow
│       └── guides/
│           └── ui-patterns.md     # Sticky toolbar, lightbox, view toggles
│
└── backend/                       # mirrors src-tauri/src/
    └── bonsai/
        └── concepts/
            └── bonsai-backend.md  # Rust integration with Bonsai (mflux) server
```

---

## Quick Routes

### By panel
| Panel | Code | Context |
|-------|------|---------|
| **Assets** | `src/panels/AssetsPanel.tsx` | `panels/assets/concepts/assets-panel.md` |
| **Create** | `src/panels/CreatePanel.tsx` + `src/panels/create/modes/{Wizard,Screens,Components,Themes}Mode.tsx` | Merged Wizard/Screens/Components/Design sub-modes via segmented control (see `project-intelligence/domain.md`) |
| APIs | `src/panels/ApisPanel.tsx` | (see `project-intelligence/domain.md`) |
| Runner | `src/panels/RunnerPanel.tsx` | (see `project-intelligence/domain.md`) |
| Library | `src/panels/LibraryPanel.tsx` | (see `project-intelligence/domain.md`) |
| Workflows | `src/workflows/WorkflowsView.tsx` | (see `project-intelligence/domain.md`) |

### By backend
| Area | Code | Context |
|------|------|---------|
| **Bonsai server** | `src-tauri/src/commands/bonsai.rs` | `backend/bonsai/concepts/bonsai-backend.md` |
| **Bonsai assets** | `src-tauri/src/commands/bonsai_assets.rs` | `backend/bonsai/concepts/bonsai-backend.md` |
| All Rust commands | `src-tauri/src/lib.rs` | (see CLAUDE.md "Rust commands" table) |

### By task
| Task | Path |
|------|------|
| **Work on the Assets panel** | `panels/assets/concepts/assets-panel.md` + `panels/assets/guides/ui-patterns.md` |
| **Work on the Bonsai server integration** | `backend/bonsai/concepts/bonsai-backend.md` |
| **Add a new Rust command** | register in `generate_handler![]` in `lib.rs` + declare permission in `capabilities/default.json` |
| **Add a new IPC wrapper** | add to `src/lib/ipc.ts` |
| **Stream AI completions** | use `Channel<CompletionEvent>` + 8-variant event enum (see CLAUDE.md "AI streaming") |
| **Persist data** | `tauri-plugin-store` for settings, raw `read_file`/`write_file` for project files |
| **Style components** | Tailwind v4 tokens in `src/styles/globals.css` (`@theme inline` block) |

---

## Key Conventions (from CLAUDE.md)

- **Package manager**: always `bun` and `bunx` — never `npm`, `npx`, `yarn`
- **Dev server**: `bun run tauri:dev` (auto-detects Wayland; raw `bun tauri dev` may fail)
- **Production build**: `bun tauri build` → `src-tauri/target/release/bundle/`
- **Tauri imports**: always `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`
- **Vite port**: 1420 (`devUrl` in `tauri.conf.json` must match)
- **Keyboard shortcuts**: `Ctrl+S` (save), `Ctrl+Z`/`Ctrl+Shift+Z` (undo/redo) — registered in `useEffect` listeners

### Common pitfalls
- **Radix UI `ContextMenu.Root`** is uncontrolled only — for controlled right-click menus use `DropdownMenu.Root` with `open`/`onOpenChange`
- **Wayland crash**: use `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `bun run tauri:dev`
- **IPC timeout**: never block async commands — use `tokio::spawn` for heavy ops
- **White screen**: `devUrl` port mismatch with Vite

---

## Codebase Reference Style

The three files in this category (`assets-panel.md`, `ui-patterns.md`, `bonsai-backend.md`) use **inline `**Code**:` references per section** (e.g., `**Code**: \`src-tauri/src/commands/bonsai.rs\``) rather than a single consolidated `## 📂 Codebase References` block. This deviates from `core/context-system/standards/codebase-references.md` (which uses "SHOULD" not "MUST"). The inline format keeps references co-located with the relevant content and is preferred for panel/backend docs in this category. **Future files in this category should follow the same inline convention** unless the consolidated-block style is more useful for the content.

---

## Related Context

- **Project intelligence** → `../project-intelligence/navigation.md` (full app overview, processes, standards, templates)
- **Core standards** → `../core/navigation.md` (universal code quality, workflows, context system)
- **UI patterns** → `../ui/navigation.md` (Tailwind v4, shadcn, React patterns, animations)
- **Workspace CLAUDE.md** → `../../CLAUDE.md` (canonical project reference)
