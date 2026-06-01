# Prototyper — Design Language

A structured design system for the Prototyper desktop app itself. Same facet structure
the app produces for user themes (`DesignLanguageSpec` → `design.json` + `theme.css` +
`DESIGN.md`), turned inward. This is the source of truth for the shell UI — panels,
canvases, nodes, chrome — **not** for generated apps.

> **Archetype:** *Quiet Instrument.* A neutral, near-monochrome professional tool where
> the user's work (graphs, code, generated UI) is the only color on screen. The app
> recedes; content advances.

---

## Philosophy

Prototyper is a workbench, not a website. Three principles:

1. **The chrome is greyscale; the work is in color.** Node-type hues, status colors, and
   the generated preview are the only saturated pixels. Everything structural —
   toolbars, panels, trees, properties — is built from a single neutral ramp so the eye
   goes to the canvas, never the frame.
2. **Density without clutter.** This is a power tool used for hours. Information density
   is high, but achieved through hairlines, restraint, and hierarchy — not boxes,
   shadows, or fills.
3. **State is communicated by color and motion, sparingly.** A node turning amber, a
   pulsing dot, a thin progress bar. Decoration is never used where state isn't being
   communicated.

---

## Color

All colors are `oklch()`. The shell is a single neutral ramp; meaning-bearing color is
reserved for node types and run status.

### Neutrals (the entire shell is built from these)

| Token | Light | Dark | AMOLED | Role |
|---|---|---|---|---|
| `--background` | `oklch(1 0 0)` | `oklch(0.145 0 0)` | `oklch(0 0 0)` | App / canvas base |
| `--card` | `oklch(1 0 0)` | `oklch(0.205 0 0)` | `oklch(0.07 0 0)` | Panels, nodes, popovers |
| `--muted` | `oklch(0.97 0 0)` | `oklch(0.269 0 0)` | `oklch(0.1 0 0)` | Hover, inset wells, chips |
| `--foreground` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | — | Primary text |
| `--muted-foreground` | `oklch(0.556 0 0)` | `oklch(0.708 0 0)` | — | Secondary text, labels |
| `--border` | `oklch(0.922 0 0)` | `oklch(1 0 0 / 10%)` | `oklch(1 0 0 / 8%)` | Hairlines, dividers |
| `--primary` | `oklch(0.205 0 0)` | `oklch(0.922 0 0)` | — | Primary action, selection |

Dark is the default. AMOLED is dark with true-black backgrounds for OLED displays.

### Accent

`--primary` is **near-monochrome by default** (a near-white in dark mode). A user-chosen
accent hue (Tweaks) shifts `--primary` and `--ring` only — it never colors structural
chrome. Curated options, never a free picker:

`blue 259° · violet 280° · teal 180° · amber 70° · emerald 155° · rose 15°`

### Node-type palette (Workflows)

Each node category owns a hue, shown as a 2px accent bar on the node and the palette
icon. Tuned for the dark canvas; a separate light set exists.

| Category | Token (dark) | Hue |
|---|---|---|
| IO | `--node-io` | emerald `162°` |
| Analysis | `--node-analysis` | gold `70°` |
| Planning | `--node-planning` | violet `304°` |
| Generation | `--node-generation` | blue `264°` |
| Composition | `--node-composition` | emerald `162°` |
| Utility | `--node-utility` | rose `16°` |
| Custom | `--node-custom` | neutral `0°` |

### Status (run state)

| State | Token | Use |
|---|---|---|
| running | `--status-running` (blue) | active node border + pulsing edge |
| done | `--status-done` (emerald) | completed node + `pass` handle |
| error | `--status-error` (red) | failed node + `fail` handle |
| paused | `--status-paused` (gold) | paused node label |

**Rule:** node-type color identifies *what a node is*; status color identifies *what it's
doing*. They never mix on the same surface — type lives on the accent bar, status on the
border.

---

## Typography

| Role | Family | Use |
|---|---|---|
| Sans / UI | **Geist Variable** | All interface text |
| Mono | **Geist Mono** | Code, paths, model IDs, tokens, terminal, counts |

System fallback: `ui-sans-serif, system-ui, -apple-system, sans-serif`.

- **Display face is intentionally absent in the shell.** A tool doesn't need a headline
  voice. (Generated *apps* get display fonts — Fraunces et al. — but the workbench
  stays in one neutral sans.)
- **Scale is small and tight.** UI ranges 9–16px. Panel titles 12px/600. View titles
  16px/600 at `-0.01em` tracking. Body 12–13px. Node titles 11px/600. Micro-labels 9–10px.
- **`.caps` labels:** 10px, weight 600, `letter-spacing 0.06em`, uppercase,
  `--muted-foreground`. Used for every field label and section header.
- **Monospace carries data.** Anything machine-meaningful — file paths, `localhost:11434`,
  token counts, seeds, methods — is set in Geist Mono so it reads as "literal value."
- **Tabular numerals** for counts and token estimates so they don't jitter while
  streaming.

---

## Spacing

4px base unit. Density is user-adjustable (`--pad-y` / `--pad-x` / `--row-h`):
`compact · comfortable (default) · spacious`.

`2 · 4 · 6 · 8 · 12 · 16 · 20 · 28` — small steps dominate; this is a dense tool. Panels
use 8–12px padding, view headers 14–20px, canvases breathe with generous virtual space.

---

## Radii

| Token | Value | Use |
|---|---|---|
| `--radius` | `0.625rem` (10px) | Cards, panels, nodes, buttons |
| `- 2px` (8px) | inputs, segmented controls | |
| `- 4px` (6px) | chips, small controls | |
| `full` | `999px` | pills, status dots, port handles |

Consistent, soft, never sharp; never more than 10px on structural surfaces.

---

## Shadows

Used **only** to lift true overlays off the canvas — never for decoration on flat panels.

- Nodes / cards on canvas: `0 2px 6px rgba(0,0,0,.12)`
- Popovers / model picker / drawers: `0 16px 40px rgba(0,0,0,.30)` + `0 0 0 1px border`
- **Panels themselves cast no shadow** — they're separated by 1px borders, not elevation.

Optional **glow** (Tweaks: off / subtle / full) adds a colored halo to *running* nodes
and primary buttons only — a deliberate, state-bearing exception to the no-decoration rule.

---

## Borders

`1px solid --border` is the primary separator in the entire app. Layout is defined by
hairlines, not fills or shadows. Nodes and flow screens use `1.5px` so they read as
discrete objects on the dotted canvas. Resizable pane gutters (`.sash`) are 1px, turning
`--ring` on hover.

---

## Motion

| Token | Value |
|---|---|
| fast | `120ms` — hover, color, border transitions |
| normal | `~180ms` — drawer slide-in, reorder settle |
| pulse | `1.1s` — running status dot |
| thinking | `1.2s` staggered — three-dot node activity |

Easing: `ease-out` for entrances, linear for indeterminate (shimmer, edge flow, blink).

**Conventions:** animate to communicate work (a node firing, tokens streaming, an edge
pulsing), never to ornament. Dragging is transform-only at 60fps (no React on the hot
path). The terminal cursor blinks; the run edge carries a traveling dot.

---

## Components

### Button
- **Do** use one `--primary` filled button per view for the single most important action
  (Generate / Run). Everything else is `--card` outline or ghost.
- **Don't** place two filled buttons side by side. Don't color a button with a node hue.

### Panel
- **Do** give every panel a 38px header (`.panel-head`) with a 12px/600 title and a 1px
  bottom border. Separate panels with 1px borders, never gaps or shadows.
- **Don't** nest more than one elevation level.

### Node (Workflows)
- **Do** 160px wide, a 2px category accent bar on top, icon + 11px title, hairline
  divider, 9px description/output line, status-driven border. Branching nodes (`validate`,
  `condition`) get split `pass`/`fail` source handles in done/error colors.
- **Don't** fill the node body with the category color — it lives only on the accent bar.

### Pill / Tag / Chip
- **Pill** (rounded-full) for status & metadata: project name, model, counts. `.mono` when
  the content is a literal value.
- **Tag** (rounded-sm, mono) for token names, libraries, scale steps.

### Segmented control
- The default toggle for 2–4 short, mutually-exclusive options (device size, code/preview,
  light/dark/amoled). Past ~4 options or long labels, use a select.

### Input / Textarea
- 1px `--input` border, focus → `--ring` border + a 3px ring at 18% opacity. The chat
  composer is a bordered well that holds attachment chips + the textarea + an action row.

### Tree (sidebar)
- Collapsible sections with a count pill; leaves indent under a 1px guide line; selected
  leaf gets a `--primary` 14% wash, never a hard fill.

---

## Iconography

- **Library:** Lucide (the app); inline stroke SVGs in this prototype mirror them 1:1.
- **Stroke:** `1.6`, round caps and joins.
- **Size:** 12–14px in the dense UI, 11–13px inside nodes and chips.
- **Style:** outline only, single weight, currentColor. Icons inherit text color except
  node/category icons, which take their category hue.

---

## Layout

- **Shell:** fixed top toolbar (44–48px) → body. Body = optional Project tree (left) +
  active view. Multi-pane views use resizable Allotment-style splits with 1px gutters.
- **Canvas views** (Workflows, Flows): pan/zoom on a dotted grid; floating zoom control
  bottom-left; properties panel docked right.
- **Generation views** (Screens, Components, Design): chat/brief left · output right, with
  device/preview toggles in the output panel header.
- **Right rail** is always the inspector/properties for the current selection.
- Content max-widths are generous; the canvas is effectively infinite.

---

## Voice

- **Personality:** precise, calm, technical-but-friendly. A senior tool that respects the
  user's time.
- **Tone:** plain-spoken. Labels are nouns (`Requirements`, `Validate`, `Write File`), not
  marketing.
- **Sentence case everywhere.** No title case in UI, no exclamation marks.
- Surface the machinery honestly — show the assembled prompt, the token count, the exact
  endpoint. Trust through transparency.

---

## Content

- **Capitalization:** sentence case for all UI copy; `Tab Labels` and proper nouns
  excepted.
- **Numbers:** tabular, grouped (`128,000`), with units (`18.5 GB`, `~409 tok`, `218ms`).
- **Paths & identifiers:** always monospace, never truncated mid-token without an ellipsis.
- **Empty states teach:** one worked example or "start from a template," never a bare
  blank panel.
- **Errors** name the thing and the fix: *"Failed to sync navigation routes — retry"*, not
  *"Error 500."*

---

## Anti-patterns

- No gradients on chrome (generated apps may use them; the shell never does).
- No more than one accent hue in the shell at a time.
- No drop shadows on flat panels — separate with 1px borders.
- No saturated color on structural UI — color belongs to node types, status, and the
  user's generated output.
- No decorative icons or illustrations in the workbench.
- No rounded corners over 10px on structural surfaces.
- No motion that doesn't communicate state.
- Never hide what's sent to the model — the prompt inspector is a feature, not a debug toy.
