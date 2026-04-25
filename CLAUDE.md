# Prototyper — Claude Code Guide

## What This Is

A Tauri v2 desktop app for AI-assisted UI prototyping. React 19 + TypeScript frontend, Rust backend. Fully realized — no mocks, no stubs.

## Running the App

```bash
bun run tauri:dev      # auto-detects Wayland, sets WEBKIT_DISABLE_DMABUF_RENDERER=1 on Wayland
bun tauri dev          # raw (may fail on Wayland with protocol error 71)
bun tauri build        # production binaries → src-tauri/target/release/bundle/
```

> On Wayland (CachyOS), always use `bun run tauri:dev`. The env var disables WebKit DMABuf renderer to avoid GDK protocol error 71.

## Architecture

```
Frontend (React 19 + Vite, port 1420) ←IPC→ Rust backend (Tauri v2)
```

All Rust logic lives in `src-tauri/src/lib.rs`. `main.rs` is a thin passthrough.

Frontend IPC uses `@tauri-apps/api/core` (v2 — never `@tauri-apps/api/tauri`, that's v1).

## Key Directories

```
src/
  panels/          # 7 panels: Screens, Components, Themes, APIs, Runner, Library + Workflows
  workflows/       # WorkflowsView.tsx — graph execution engine
  layout/          # Header.tsx, SidebarRail.tsx
  hooks/           # useSettings.ts (Tauri Store), useStreamingCompletion.ts
  lib/ipc.ts       # All invoke() wrappers — single source of truth for Rust↔TS calls
  modals/          # Export, ProjectManager, Save, AddLibrary, PromptConfig, ComponentExport
  components/ui/   # shadcn/ui primitives
src-tauri/
  src/lib.rs       # All Rust commands (21 total)
  capabilities/default.json   # Tauri permissions
  tauri.conf.json  # Window config, CSP, devUrl (1420)
```

## Rust Commands (src-tauri/src/lib.rs)

| Group | Commands |
|-------|----------|
| Process | `bun_dev`, `bun_build`, `bun_install`, `run_shell_command`, `kill_process` |
| File System | `read_dir`, `read_file`, `write_file`, `create_dir`, `delete_file`, `delete_dir`, `rename_file` |
| HTTP | `http_request` |
| AI | `generate_completion`, `generate_completion_stream`, `list_ollama_models` |
| Export | `export_project`, `export_component` |
| Workflows | `save_workflow`, `load_workflow`, `list_workflows` |

Every command must be in both `generate_handler![]` and `capabilities/default.json` — missing either causes silent failure.

## AI Streaming

Uses Tauri Channel IPC (not events). Pattern:

```typescript
import { Channel } from '@tauri-apps/api/core';
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  if (msg.event === 'Chunk') append(msg.data.text);
  if (msg.event === 'Done') setLoading(false);
};
await generateCompletionStream(model, messages, host, apiKey, channel);
```

`CompletionEvent` is defined in `src/lib/ipc.ts` and mirrors the Rust enum in `lib.rs`.

## Data Persistence

- **Settings**: `tauri-plugin-store` → `settings.json` in app data dir. Hook: `useSettings()`
- **Project files**: File system via `invoke('read_file'/'write_file')` under `projects/{projectId}/`
- **Workflows**: `save_workflow`/`load_workflow` Rust commands

No `localStorage` except one-time migration of legacy keys on first launch.

## Styling

Tailwind v4 + shadcn/ui. Tokens in `src/styles/globals.css` (`@theme inline` block). Domain-specific CSS kept in `src/styles/workflows.css`, `panels.css`, `ui.css`.

## Keyboard Shortcuts

Global shortcuts use `window.addEventListener('keydown', ...)` in `useEffect` — **not** `onKeyDown` on divs with `tabIndex`. This ensures they fire regardless of focus. Current shortcuts:
- `Ctrl+S` — save file (ComponentsPanel, RunnerPanel)
- `Ctrl+Z` / `Ctrl+Shift+Z` — undo/redo (WorkflowsView)

## Project File Structure (Runtime)

```
{appDataDir}/projects/{projectId}/
  project.json
  screens/{screenId}/screen.tsx, chat.json, attachments/
  components/{compId}/component.tsx, prompt.json
  themes/{themeId}/theme.css, prompt.json
  workflows/{workflowId}.json
  apis/{apiId}.json
  generated/         ← bun dev runs here; Runner panel previews localhost:5173
```

## Package Manager

Always use `bun` and `bunx` — never `npm`, `npx`, or `yarn`.

```bash
bun install          # install deps
bun add <pkg>        # add package
bunx shadcn@latest   # run package binaries
bunx tsc --noEmit    # type-check
```

## Common Pitfalls

- **White screen**: `devUrl` in `tauri.conf.json` must match Vite's port (`1420`)
- **Command not found**: Must be in both `generate_handler![]` and `capabilities/default.json`
- **Wayland crash**: Use `WEBKIT_DISABLE_DMABUF_RENDERER=1` or `bun run tauri:dev`
- **IPC timeout**: Never block async commands — use `tokio::spawn` for heavy ops
- **v1 vs v2 imports**: Always `@tauri-apps/api/core`, never `@tauri-apps/api/tauri`
- **Package manager**: Never use `npx` or `npm` — always `bun`/`bunx`

## Coding Rules

## CRITICAL — DO NOT SUBSTITUTE LIBRARIES
- **NEVER assume a library is broken and switch to a workaround or alternative without consulting the user first.**
- If a library behaves unexpectedly, investigate the root cause (read docs, check source, search online). Do not silently replace it with a different approach.
- Always consult the user before changing libraries, APIs, or fundamental implementation strategies.

## CRITICAL — NEVER USE TEMP DIRECTORIES FOR SCAFFOLDING
- **DO NOT USE TEMP DIRECTORIES and then move files to `generated/`. THAT IS NEVER EVER GOING TO BE A GOOD SOLUTION.**
- Temp directories create race conditions, permission issues, and stale file problems.
- If a CLI tool refuses to scaffold into a non-empty directory, the correct approach is to save user data, clear the target directory, scaffold into the now-empty directory, then restore user data.

## URGENT - DO NOT REVERT UNCOMMITTED FILES
- **CRITICAL: NEVER use `git checkout`, `git revert`, or any git command that discards uncommitted changes.**
- If you need to fix something, build ON TOP of existing changes, never discard them.
- If you're unsure about the current state, use `git status` or `git diff` to understand what changed.
- Breaking this rule will result in immediate termination of the task.

## Types
- NEVER use `any` type in TypeScript or JSDoc
- Use specific types, `unknown`, `object`, or `Record<string, unknown>` instead
- NEVER ignore eslint rules. DO NOT add ignore lines.
- NEVER hardcode types or structures that exist in external packages. ALWAYS import and reuse types from the source package (e.g., use `import type { Options } from 'ollama'` instead of recreating the interface)
- **NEVER recast types if they can be inferred from usage.** Let TypeScript infer types naturally. If TypeScript infers `any`, fix the root cause (add proper types to the source) instead of recasting.

## External Libraries & APIs
- **URGENT: ALWAYS search Context7 when implementing new libraries, APIs, or any code that has external documentation.** This includes but is not limited to: npm packages, frameworks, SDKs, APIs, CLI tools, cloud services. Even for well-known libraries like React, Next.js, Prisma - ALWAYS check Context7 first to get current documentation. Your training data may be outdated. NEVER assume you know the current API without checking.

## Adherence to Approved Plans
- **CRITICAL: NEVER deviate from an approved plan or todo list.** Once a plan is approved, execute it exactly as specified. Do not skip steps, change scope, or substitute simpler alternatives without explicit user approval.
- **CRITICAL: DO NOT go for the "simplest approach" or take shortcuts.** Implement what was requested properly, even if it requires more effort, research, or code.

## Quality Standards
- **NEVER compromise on the user's request.** Do not take the "simplest approach" or a shortcut just to get out of a difficult or long task. If the user asks for something, implement it properly.
- **NEVER leave or hide or skip or ommit or ignore for any reason linting errors and NEVER use excuses like lint errors are pre existing and hide them from the user.**
- **NEVER guess or hallucinate implementations.** When working with external libraries (e.g., `react-frame-component`), ALWAYS verify against official documentation or GitHub examples. Provide links to the examples/docs you followed.
- **NEVER guess CLI flags or command behavior.** When using external CLI tools (e.g., `bun create vite`, `bun init`, `vite build`), ALWAYS check Context7 or official docs for the exact flags and behavior. Do NOT assume flags like `--force`, `--yes`, or `--non-interactive` exist without verification.
- **Avoid hacky solutions.** If a proper solution requires more research (Context7, official docs), do the research. Do not patch around problems with workarounds.
- **CRITICAL: NEVER use `setTimeout` or any other timing hack to "defer" rendering or "wait for mount" in React.** If code needs to wait for a component to mount, use the correct React pattern (effects with proper dependencies, state-driven rendering, refs with layout effects, or library-specific declarative APIs). Timing hacks are brittle, cause race conditions, and mask the real problem.
- **CRITICAL: NEVER EVER redefine types or recreate interfaces when they already exist in external packages.** ALWAYS import and reuse types from the source package. Do not create local copies of library types just to "make TypeScript happy" — fix the root cause or use the library's exported types correctly.

## Allotment (Split Pane Library)

- **Use `visible` prop on `Allotment.Pane` for declarative show/hide.** Never use imperative `resize()` for collapse/expand toggles.
- **Never use magic numbers like `9999` in `resize()` calls.** If you need a "fill remaining" pane, set `minSize` on other panes and let Allotment distribute space naturally.
- **`resize()` is only safe in event handlers (click, drag).** NEVER call `resize()` in `useEffect` or `requestAnimationFrame` — it crashes with `TypeError: undefined is not an object (evaluating 'pane.minimumSize')` because panes haven't laid out yet.
- **`preferredSize` is NOT reactive.** It only affects initial mount sizing and `reset()`. Do not set it dynamically based on state to try to resize panes — it won't work after mount.
- **For collapse/expand patterns with a visible header:** Split into two `Allotment.Pane` elements — one locked-size header pane (`minSize={28} maxSize={28}`) and one content pane with `visible={isOpen}`. This is the proper documented pattern, not `resize([9999, size])`.
- **`useAllotmentLayout` hook** persists pane sizes via `onDragEnd` and restores them via `defaultSizes`. When changing pane count, update the `paneCount` parameter accordingly.

## Dead Code

- **NEVER leave dead code, unused variables, unused imports, or code "for legacy" / "compatibility".** If it's not used, delete it. If you need it back, use git history.
- **TypeScript errors are never "pre-existing".** If `tsc --noEmit` reports errors, fix them immediately. Do not skip or dismiss them.
