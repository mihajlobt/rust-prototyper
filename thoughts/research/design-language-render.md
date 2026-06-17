# Design Language Render Pipeline — Research

**Status:** Complete (references verified via web search + direct page fetches)  
**Goal:** Replace the current 3-file generation (CSS + design.json tokens + DESIGN.md) with a single-source `DESIGN.md` file that transpiles to all other formats. Also establish app-wide document → HTML capability for the Plans panel.

---

## Current Architecture

```
AI generates 3 separate files:
  theme.css          ← Tailwind/shadcn CSS custom properties (light + dark)
  design.json        ← Token JSON (used to render ThemeTokenPreview in React)
  DESIGN.md          ← Human-readable design language spec
```

**Problems:**
- Three separate AI generations = drift between formats
- design.json schema is app-specific; re-rendering requires React
- No portable/shareable preview without the app
- Token values in CSS, JSON, and Markdown can go out of sync

---

## Desired Architecture

```
AI generates 1 canonical file:
  DESIGN.md          ← Single source of truth (design language spec + embedded tokens)

Transpile pipeline (in-app, no network, no external deps):
  DESIGN.md → design.json    (W3C DTCG-aligned token JSON)
  DESIGN.md → theme.css      (CSS custom properties, light + dark)
  DESIGN.md → preview.html   (self-contained HTML, no external links)
```

---

## Constraints

- **Tauri v2 desktop app** — tools must be embeddable or runnable locally (no CDN at render time)
- **Self-contained HTML** — preview must work as a file dropped in any browser with no network
- **Plans panel parity** — MD→HTML pipeline must also work for Plans section documents
- **Performance** — ideally < 50ms parse, < 200ms full render on mid-range hardware
- **No mandatory pandoc binary** — adding a 20–40MB binary sidecar for a pure render job is overkill

---

## Research Findings

---

### 1. Rust Markdown Parsers (for Tauri backend)

#### pulldown-cmark — **Recommended**
- **Repo**: https://github.com/pulldown-cmark/pulldown-cmark
- **Version**: v0.13.4 (May 20, 2026)
- **Monthly downloads**: 11.7 million (most-used Rust MD crate — used in 3,261 crates)
- **Benchmark**: 2.179s for 100K iterations on Intel i7 (2020), ~2× faster than comrak
- **Architecture**: Pull iterator — no AST; fast streaming HTML generation
- **GFM support**: Tables, task lists, strikethrough, autolink, footnotes
- **Front matter**: NOT built-in — use companion crate `pulldown-cmark-frontmatter`
- **Syntax highlighting**: NOT built-in — use `syntect` crate separately
- **Output**: Generates raw HTML via `pulldown_cmark::html::push_html()`
- **Self-contained HTML**: No — you provide the wrapping template + inline CSS yourself
- **Source**: https://lib.rs/crates/pulldown-cmark

#### comrak
- **Repo**: https://github.com/kivikakk/comrak
- **Version**: active (check crates.io for latest)
- **Benchmark**: 11.113s for 100K iterations (2020) — ~5× slower than pulldown-cmark due to AST construction
- **Architecture**: Builds a full AST — slower for throughput, but AST manipulation is easier
- **GFM support**: Widest feature catalog of any Rust MD parser
- **Front matter**: Built-in front matter stripping option
- **Syntax highlighting**: Via `syntect` integration
- **Use case**: When you need to walk/modify the AST; overkill for pure HTML generation
- **Source**: https://crates.io/crates/comrak

#### ferromark — Fastest but immature
- **Repo**: https://github.com/sebastian-software/ferromark
- **Version**: v0.1.3 (February 9, 2026) — 3 GitHub stars
- **Benchmark** (Apple Silicon, Feb 2026): 309.3 MiB/s — 17% faster than pulldown-cmark (271.7), 4× faster than comrak (76.0)
- **Architecture**: Streaming, no AST — similar philosophy to pulldown-cmark but newer
- **GFM support**: All 5 GFM extensions + footnotes, front matter, heading IDs, math, callouts
- **Verdict**: Technically impressive but 3 stars and pre-1.0. Not recommended for production yet.
- **Source**: https://crates.io/crates/ferromark

#### Benchmark summary (1Password, 100K iterations, Intel i7 2020)
| Library | Time | Relative |
|---------|------|----------|
| md4c (C) | 1.174s | fastest |
| **pulldown-cmark (Rust)** | **2.179s** | **1.9× md4c** |
| Hoedown (C) | 2.238s | 1.9× md4c |
| Cmark (C) | 4.653s | 4× md4c |
| Blackfriday (Go) | 7.419s | 6.3× md4c |
| comrak (Rust) | 11.113s | 9.5× md4c |

Source: https://github.com/1Password/markdown-benchmarks

**Note**: ferromark (2026) claims to beat even md4c at 309 MiB/s vs ~247 MiB/s, but it's unverified in this benchmark suite.

---

### 2. Front Matter (for DESIGN.md metadata)

#### pulldown-cmark-frontmatter
- **Repo**: https://crates.io/crates/pulldown-cmark-frontmatter
- **What**: Companion crate for parsing front matter alongside pulldown-cmark
- **⚠️ IMPORTANT**: Does NOT use `---`-delimited YAML front matter. It uses a code block format (optional title heading + fenced code block). If you need conventional `---` YAML front matter, this crate will not work as expected.
- **Maturity**: v0.4.0 (Sept 2024), ~153 downloads/month — low traffic, not widely adopted
- **Better alternative for `---` YAML front matter**: A simple custom split (split on `\n---\n`, parse YAML with the `serde_yaml` crate) is more reliable and requires no extra dependency
- **Source**: https://lib.rs/crates/pulldown-cmark-frontmatter

---

### 3. Design Token Converters

#### Style Dictionary v4 — **Recommended for token → CSS**
- **Repo**: https://github.com/style-dictionary/style-dictionary (note: org moved to `style-dictionary/` org)
- **What**: Build system that transforms design tokens (JSON) to CSS, SCSS, JS/TS, Android, iOS, and more
- **Version**: v4 (active) — v5 in progress for fuller W3C DTCG 2025.10 support
- **DTCG support**: First-class in v4. Accepts both `value`/`type` (v3 style) and `$value`/`$type` (DTCG style)
- **Tauri integration**: Node.js library — run as a Bun script via `run_shell_command_capture`, or integrate into Vite build
- **Output formats**: CSS custom properties, SCSS, JS object, TypeScript, JSON, Android XML, iOS Swift
- **Best for**: Token JSON → multiple output formats in one pass
- **Source**: https://styledictionary.com/info/dtcg/ (v4 DTCG support + v5 roadmap both documented here)

#### Terrazzo (formerly Cobalt UI)
- **Repo**: https://github.com/drwpow/cobalt-ui (redirects to terrazzoapp/terrazzo)
- **What**: W3C DTCG-focused design token pipeline; renamed from `cobalt-ui` to `Terrazzo` in v2
- **Strict DTCG**: "NOT its own format; an implementation of DTCG as close to the spec as possible"
- **Output formats**: CSS, Sass, JS/TS, universal JSON
- **Tauri integration**: CLI (`@cobalt-ui/cli` or terrazzo CLI) — call via Bun
- **Source**: https://cobalt-ui.pages.dev/

#### Theo (Salesforce) — Archived, do not use
- **Status**: Archived 2024. Superseded by Style Dictionary v4.

---

### 4. W3C Design Token Community Group (DTCG) Format

**Important**: The `2025.10` spec reached "first stable version" on October 28, 2025 per W3C press release — but the actual draft document at designtokens.org explicitly states:

> "Do not attempt to implement this version of the specification. Do not reference this version as authoritative in any way."

This means the spec is still a **Draft Community Group Report**, not a W3C Recommendation. Use it as a reference but expect breaking changes.

**Format** (as of 2025.10 draft):
```json
{
  "color": {
    "primary": {
      "$value": "#3B82F6",
      "$type": "color",
      "$description": "Primary brand color"
    }
  },
  "spacing": {
    "base": {
      "$value": "16px",
      "$type": "dimension"
    }
  }
}
```

**Supported `$type` values**: `color`, `dimension`, `font-family`, `font-weight`, `duration`, `cubic-bezier`, `number`, plus composite types: `stroke-style`, `border`, `transition`, `shadow`, `gradient`

**File extension**: `.tokens` or `.tokens.json` / media type `application/design-tokens+json`

**Sources**: 
- https://www.designtokens.org/tr/drafts/format/
- https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/
- https://designzig.com/design-tokens-specification-reaches-first-stable-version-with-w3c-community-group/

---

### 5. Self-Contained HTML Generation

Three viable approaches, ordered by recommendation for this project:

#### Option A: Custom Rust template + pulldown-cmark (Recommended)
1. `pulldown-cmark` parses DESIGN.md → HTML body
2. Rust `include_str!()` inlines a minimal CSS stylesheet at compile time
3. Wrap with a full `<!DOCTYPE html>` template
4. Output: one `.html` file, ~15–50KB, zero external links
5. **Pros**: No new dependencies, fast (< 10ms), fully controllable
6. **Cons**: You write/maintain the CSS template

**Inline CSS sources to use** (can bundle at compile time):
- GitHub Markdown CSS: https://github.com/sindresorhus/github-markdown-css (MIT, single file, well-maintained)
- Minimal reset: ~2KB

#### Option B: markdown2html-converter crate
- **Repo**: https://crates.io/crates/markdown2html-converter
- **What**: Rust crate that produces a self-contained HTML file from Markdown
- **How**: Uses `comrak` for parsing + inlines `sindresorhus/github-markdown-css` + auto-embeds `highlight.js` for code blocks and `mathjax.js` for math
- **Output**: Single `.html` with all CSS/JS inlined
- **Pros**: Zero config, batteries included
- **Cons**: Uses comrak (slower), embeds highlight.js (~50KB) even if not needed, less control
- **Verdict**: Useful as a reference implementation, but Option A gives more control

#### Option C: Pandoc sidecar
- **Binary size**: ~20–40MB per platform
- **Tauri support**: Confirmed via `externalBin` in `tauri.conf.json`
- **Real-world example**: https://github.com/ivg-design/pandoc-gui-mk2 (Tauri v2 app) — but notably, this app requires users to **install pandoc separately** rather than bundling it
- **Self-contained HTML command**: `pandoc input.md -o output.html --standalone --embed-resources`
- **Verdict**: Overkill for this use case. Adds 20–40MB to bundle, 100–300ms latency per conversion, and the real-world Tauri example chose NOT to bundle it. Reserve for export-to-DOCX/PDF features if needed later.
- **Source**: https://v2.tauri.app/develop/sidecar/

---

### 6. The Token Extraction Gap: Markdown → Tokens

There is **no established tool** that goes directly from Markdown prose to design tokens. The gap must be bridged with a convention embedded in the DESIGN.md file.

#### Recommended convention: fenced `tokens` block

````markdown
---
title: Ocean Design Language
version: 1.0.0
---

# Ocean Design Language

A calm, coastal design system for trust-building products.

## Color

```tokens
{
  "color": {
    "primary": { "$value": "#1A6B8A", "$type": "color" },
    "surface": { "$value": "#F0F7FA", "$type": "color" }
  }
}
```

## Spacing

```tokens
{
  "spacing": {
    "base": { "$value": "16px", "$type": "dimension" },
    "lg": { "$value": "24px", "$type": "dimension" }
  }
}
```

## Typography guidelines

Use Inter for body copy and Playfair Display for headings...
````

**Parsing strategy (Rust):**
1. `pulldown-cmark-frontmatter` → strip YAML front matter → parse into metadata struct
2. Walk pulldown-cmark events; collect all `CodeBlock { kind: Fenced("tokens") }` items
3. `serde_json::merge` all extracted token objects into one DTCG JSON
4. Pass merged JSON to Style Dictionary (via Bun) or Terrazzo for CSS generation

**Alternative: Table-driven (more human-readable, harder to parse precisely)**
```markdown
| Token | Value | Type | Description |
|-------|-------|------|-------------|
| color.primary | #1A6B8A | color | Primary brand color |
```
Parseable but requires a custom table parser and loses nested group structure. Not recommended.

**designtoken.md** (https://designtoken.md/) uses a structured markdown format (150+ lines with full color scales, typography, spacing, component tokens — not simply "table-based") optimized for AI coding agents reading files as context, but it's focused on AI readability, not machine parsing for transpilation.

---

### 7. Tauri Sidecar Pattern (if Pandoc or Bun is needed)

For calling external binaries (e.g., Style Dictionary via Bun, or pandoc if added later):

**`src-tauri/tauri.conf.json`:**
```json
{
  "bundle": {
    "externalBin": ["binaries/md-transpiler"]
  }
}
```

**Platform binary naming** (required by Tauri):
```
src-tauri/binaries/md-transpiler-x86_64-unknown-linux-gnu
src-tauri/binaries/md-transpiler-aarch64-apple-darwin
src-tauri/binaries/md-transpiler-x86_64-pc-windows-msvc.exe
```
Get your target triple: `rustc --print host-tuple`

**Rust invocation:**
```rust
use tauri_plugin_shell::ShellExt;
let sidecar = app.shell().sidecar("binaries/md-transpiler").unwrap();
let output = sidecar.args(["--input", "DESIGN.md"]).output().await?;
```

**Capabilities (`capabilities/default.json`):**
```json
{
  "permissions": [
    "shell:allow-execute",
    { "identifier": "shell:allow-execute", "allow": [{ "name": "binaries/md-transpiler", "sidecar": true }] }
  ]
}
```

Source: https://v2.tauri.app/develop/sidecar/

---

### 8. Prior Art and Inspiration

#### mdBook (Rust)
- **Repo**: https://github.com/rust-lang/mdBook
- **Relevance**: Uses pulldown-cmark for MD→HTML with inlined themes; excellent reference for the Rust-native pipeline pattern
- **Note**: Multi-page static site, but the core MD→HTML + CSS injection pattern is directly applicable

#### Quartz (Obsidian → HTML)
- **Repo**: https://github.com/jackyzha0/quartz
- **Relevance**: Converts Obsidian vaults (Markdown + YAML front matter) to fully self-contained static sites; shows front matter → metadata → styled HTML pipeline

#### HastyScribe — Archived
- **Repo**: https://github.com/h3rald/hastyscribe
- **Language**: Nim (not Rust)
- **Status**: Archived June 16, 2026; moved to SourceHut. Not recommended.

#### designtoken.md
- **Site**: https://designtoken.md/
- **What**: A markdown-first design token format optimized for AI coding agents (Claude Code, Cursor, Copilot)
- **Format**: A 150+ line structured markdown document with full color scales (50–900), typography scale (9 levels), spacing, border radius, shadows, and component tokens. Not simply table-based — it's rich prose + structured data with tables as one of several elements.
- **Relevance**: Directly validates the concept of "one markdown file as source of truth for design tokens"
- **Limitation**: Focused on AI agent readability in context; the generator produces the markdown file but does not offer programmatic CSS or DTCG JSON transpilation

---

## Recommended Architecture for Prototyper

```
┌─────────────────────────────────────────────────────────────┐
│  AI Generation (ThemesMode — single generation)             │
│  Input: user prompt + design brief seed                     │
│  Output: DESIGN.md (one file)                               │
│    ┌─────────────────────────────────────────────────────┐  │
│    │ ---                                                  │  │
│    │ title: Ocean Design Language                        │  │
│    │ version: 1.0.0                                      │  │
│    │ ---                                                  │  │
│    │                                                      │  │
│    │ # Design Language                                   │  │
│    │ Rationale, principles, usage guidelines…            │  │
│    │                                                      │  │
│    │ ```tokens                                           │  │
│    │ { "$value": "#1A6B8A", "$type": "color" … }        │  │
│    │ ```                                                  │  │
│    └─────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ write_file("DESIGN.md")
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  Rust parse_design_md command (new Tauri command)           │
│  1. Custom `---` split + serde_yaml → extract front matter  │
│  2. pulldown-cmark events → collect ```tokens blocks         │
│  3. serde_json merge → single DTCG-aligned tokens.json      │
│  4. Token → CSS: iterate tokens, emit CSS custom properties  │
│     (light mode: :root { }, dark mode: .dark { })           │
│  5. pulldown-cmark → HTML body string                       │
│  6. Wrap HTML body with inline template + github-md CSS     │
└──────┬────────────────┬────────────────┬────────────────────┘
       │                │                │
       ▼                ▼                ▼
  design.json       theme.css       preview.html
  (DTCG tokens)   (CSS vars)      (self-contained)
       │
       ▼
  ThemeTokenPreview     Plans panel export
  (existing React)      (same render_md_to_html command)
```

**New Tauri commands to add:**
| Command | Input | Output | Use |
|---------|-------|--------|-----|
| `parse_design_md` | `{ path: String }` | `{ tokens: Value, css: String, html: String, meta: Value }` | ThemesMode |
| `render_md_to_html` | `{ content: String, inline_css: bool }` | `String` (HTML) | Plans export |

**Crates to add (`src-tauri/Cargo.toml`):**
```toml
pulldown-cmark = "0.13"
# Note: pulldown-cmark-frontmatter uses a code-block format, NOT `---` YAML.
# For standard `---` YAML front matter, do a manual split + serde_yaml instead:
serde_yaml = "0.9"
serde_json = "1"                     # already present likely
```

**CSS generation approach** (no Style Dictionary needed for basic pipeline):
- For each token in the merged DTCG JSON, map `$type` → CSS property:
  - `color` → `--color-{path}: {value};`
  - `dimension` → `--spacing-{path}: {value};`
  - etc.
- Light/dark split: tokens with `"$extensions": { "mode": { "dark": "..." } }` → emit both `:root` and `.dark` blocks
- For more complex transforms: pipe the merged JSON through Style Dictionary v4 via `run_shell_command_capture` (Bun is already available)

---

## Plans Panel Integration

The same `render_md_to_html` command supports Plans section export:

| Context | Renderer | Why |
|---------|----------|-----|
| Live in-app edit preview | react-markdown + remark-directive (existing) | Real-time, integrated with React state |
| Export / share as file | `render_md_to_html` Rust command → self-contained HTML | Offline, no deps |
| Design token preview | `parse_design_md` + ThemeTokenPreview | Existing component, no change |

The Plans panel's current `react-markdown` rendering stays untouched for interactive use. The new Rust pipeline is an **export/derive path**, not a replacement for the live editor view.

---

## References (Verified)

| Claim | Source | Status |
|-------|--------|--------|
| pulldown-cmark v0.13.4, 11.7M downloads/mo | https://lib.rs/crates/pulldown-cmark | ✅ Verified |
| Benchmark: pulldown-cmark 2.179s, comrak 11.113s (100K iters) | https://github.com/1Password/markdown-benchmarks | ✅ Verified |
| ferromark 309 MiB/s vs pulldown-cmark 271.7 MiB/s (50KB, ~14% faster; ferromark's own "17%" uses a 5KB dataset) | https://github.com/sebastian-software/ferromark | ✅ Verified (3 stars, v0.1.3) |
| pulldown-cmark-frontmatter uses code-block format, NOT `---` YAML front matter | https://crates.io/crates/pulldown-cmark-frontmatter | ✅ Verified — ⚠️ does not parse conventional YAML front matter |
| pulldown-cmark-frontmatter v0.4.0 (Sept 2024), ~153 downloads/month — low maturity | https://lib.rs/crates/pulldown-cmark-frontmatter | ✅ Verified |
| Style Dictionary v4 DTCG first-class support; v5 for fuller 2025.10 support | https://styledictionary.com/info/dtcg/ | ✅ Verified (both claims on same page) |
| DTCG 2025.10 spec: "Do not implement" (still a draft) | https://www.designtokens.org/tr/drafts/format/ | ✅ Verified |
| Cobalt UI renamed to Terrazzo | https://github.com/drwpow/cobalt-ui | ✅ Verified (HTTP 302 → terrazzoapp/terrazzo) |
| Tauri v2 externalBin sidecar: `-$TARGET_TRIPLE` suffix, `shell:allow-execute` for `.output()`, `shell:allow-spawn` for `.spawn()` | https://v2.tauri.app/develop/sidecar/ | ✅ Verified |
| markdown2html-converter uses comrak + github-markdown-css + highlight.js inline | https://crates.io/crates/markdown2html-converter | ✅ Verified |
| pandoc-gui-mk2 requires user to install pandoc (not bundled as sidecar) | https://github.com/ivg-design/pandoc-gui-mk2 | ✅ Verified |
| hastyscribe archived June 16, 2026, written in Nim (not Rust) | https://github.com/h3rald/hastyscribe | ✅ Verified |
| designtoken.md — 150+ line structured markdown for AI agents; not simply table-based | https://designtoken.md/ | ✅ Verified |
| W3C DTCG spec reached "first stable version" Oct 28, 2025 | https://www.w3.org/community/design-tokens/2025/10/28/design-tokens-specification-reaches-first-stable-version/ | ✅ Verified |

---

## Open Questions (for implementation phase)

1. **Token CSS generation**: Write a custom Rust iterator vs. shelling out to Style Dictionary via Bun? Custom is simpler for basic cases; Style Dictionary needed for platform tokens (iOS/Android).

2. **Dark mode encoding in DESIGN.md**: Use `$extensions.mode.dark` per DTCG draft? Or use a `dark-tokens` fenced block alongside `tokens`? The latter is cleaner for AI generation.

3. **Inline CSS budget**: GitHub Markdown CSS is ~7KB minified. Is this acceptable in the self-contained HTML, or should we use a more minimal reset?

4. **Plans panel export**: Add an "Export to HTML" button to the Plans toolbar, or auto-generate on save?

5. **Token preview compatibility**: `ThemeTokenPreview` currently reads CSS custom properties from `theme.css`. With the new pipeline, CSS is derived from DESIGN.md — verify the property name conventions match.
