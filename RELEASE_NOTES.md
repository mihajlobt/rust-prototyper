# Release Notes

## v0.1.1 (2026-06-05)

Patch release. Fixes two permission-card bugs and reorganises the Settings tabs.

### Fixes

- **Permission card IPC errors** (`5bd2c38`): `ToolPermissionCard` now wraps `resolveToolPermission` in a try-catch so `onResolve` is always called even if the IPC fails. Previously the card stayed stuck and the Rust side timed out after 300 s defaulting to Rejected.
- **Double ToolResult on AlwaysAllowed** (`5bd2c38`): removed the synthetic `ToolResult` emitted before `execute_tool` for `AlwaysAllowed` — it was resolving the pending UI call with "Added to allowlist…", causing the actual tool result to be lost.
- **Stale permission cards on stop/new message** (`2bf8b63`): stale cards no longer linger after a stop or a new message.

### Changes

- **Settings > AI tab**: now contains only Providers (host / API keys).
- **Settings > Agents tab**: gains Tool Permission mode, always-allowed list, Max Tool Calls (global + per-panel); Tool Access table is now collapsible (collapsed by default).
- **Settings > Styles tab**: gains Icon Library selector (moved from AI tab).

### Documentation

- Added `RELEASE_NOTES.md` at repo root for human-readable release history.

### Notes

- All other behavior from v0.1.0 is preserved. Safe drop-in upgrade.
- Same platform support: Linux x86_64, macOS arm64, macOS x64.

---

## v0.1.0 (2026-06-05)

First public release of Prototyper. AI-powered UI prototyping desktop app built on Tauri v2 (Rust backend) + React 19 + TypeScript. Connects to local Ollama, Ollama Cloud, OpenAI, and Claude for code generation; spawns real `bun dev` processes for live preview.

### Highlights

- **9 panels** — Wizard, Screens, Components, Themes, APIs, Runner, Library, Assets, Workflows
- **44 Rust commands** — Process management, file system, HTTP, AI streaming, Bonsai image generation, export, workflows
- **Channel-based AI streaming** — 8-variant `CompletionEvent` enum (`Chunk`, `ToolCall`, `ToolPermission`, `ToolResult`, `AskUser`, `AskUserForm`, `Done`, `Error`)
- **Bonsai integration** — local mflux Python server with process lifecycle management, health checks, and GPU cleanup
- **Internal docs site** — https://rust-prototyper.pages.dev/ (rewritten with new architecture/, getting-started/, standards/ sections)

### Platforms

- Linux x86_64 — `.deb`, `.AppImage`, `.rpm`
- macOS arm64 (Apple Silicon) — `.dmg`, `.app.tar.gz`
- macOS x64 (Intel) — `.dmg`, `.app.tar.gz`

### Fixes

- **macOS build** (`9fdb0c5`): replaced inner `.collect()` trait inference with a concrete-typed loop in `ai_ollama.rs` to bypass a rustc E0275 overflow triggered by the transitive `objc2` dep on macOS
- **Tauri version alignment** (`a4d0b31`): bumped `@tauri-apps/api` and `@tauri-apps/cli` from `^2` to `^2.11` to match the Rust crate `tauri 2.11.2` (eliminates the `Found version mismatched Tauri packages` warning on dev start)
- **Theme preview** (`ecc77e3`): scoped preview via block extraction instead of per-property parsing

### Infrastructure

- **CI** (`177d7db`): added `workflow_dispatch` trigger to `release.yml` for ad-hoc builds without burning a release tag
- **Docs site** (`9fdb0c5`): rewrote `/docs` (Phase 1) — 16 new pages, expanded navigation, improved styling, fixed pre-existing permalink bug

### Install

```bash
# Linux
sudo dpkg -i Prototyper_0.1.0_amd64.deb
# or
chmod +x Prototyper_0.1.0_amd64.AppImage && ./Prototyper_0.1.0_amd64.AppImage

# macOS — open the .dmg and drag Prototyper to Applications
```

### Notes

- macOS binaries are **unsigned** — first launch will require right-click → Open
- Requires `bun` and Rust for development; pre-built binaries are self-contained
- Linux deps required for building from source: `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`
