# Prototyper — Improvement Suggestions

Notes after aligning the prototype to the current codebase (9 sections, 30 workflow
nodes, Flows vs Workflows split, design-language spec, Tauri sandbox). Grouped by
theme. Each item is independent — cherry-pick.

---

## 1. End-to-end flow: make "prompt → running app" one continuous spine

Right now the sections are powerful but feel like separate tools. The biggest lever is
a **single guided spine** that threads them together so a first-timer can go from idea
to a running app without knowing which tab to click.

- **"New app" wizard** (one modal, 4 steps): *Describe → Design language → Screens →
  Generate.* Each step writes the same on-disk artifacts the manual tabs do, so power
  users still get the graph. The wizard is just an opinionated path through Design →
  Screens → Flows → Runner.
- **A persistent "Build" status bar** across the bottom: shows the active workflow run,
  current node, tsc/lint/build status of `generated/`, and the dev-server dot. Today
  that state is scattered (Runner tab, node colors, toasts). One bar = one mental model.
- **Promote Flows to the project's home view.** Flows *is* the app's sitemap. Opening a
  project to the screen-graph (with thumbnails) orients the user faster than a blank
  workflow canvas. Double-click a screen → opens it in Screens with chat.
- **Close the loop visually:** when a workflow's Output node writes a screen, animate a
  hand-off into the Flows graph (new node slides in). Generation should feel like it's
  *populating the app*, not emitting a file into the void.

---

## 2. Workflows: from "node editor" to "agent you can trust"

The node set is already deep (condition, loop-until, memory, summarize). The gap is
**observability and reuse**.

- **Run timeline / trace panel.** A horizontal lane under the canvas showing each node's
  start/stop, token count, cost, and a click-to-expand of its actual input/output. This
  is the single most valuable addition for debugging agent flows — right now a failed
  run just turns a node red.
- **Per-node I/O inspector** reusing the PromptInspector: for any AI node, show the
  *exact* assembled prompt (system + upstream outputs + injected design tokens + tools)
  and the raw model response. You already built the inspector for Screens — generalize it.
- **Dry-run / cost estimate** before executing: walk the graph, sum estimated tokens per
  node against each node's model, show "~38k tokens, ~$0.04, ~25s" so users aren't
  surprised by a 2-minute run.
- **Sub-workflows (node groups).** Let a saved workflow be dropped *as a node* inside
  another. "Generate + self-heal" becomes one reusable block. This is how node tools
  (n8n, ComfyUI) scale past toy graphs.
- **Live edge data preview:** hovering an edge shows a peek of the payload flowing
  through it (first 200 chars). Makes the "where did this break" question answerable
  without opening every node.
- **Validation gutter on the canvas:** detect cycles, orphan nodes, type-mismatched
  ports, and a Generation node with no Design System upstream — surface as soft warnings
  before Run.

---

## 3. Design language → generation: tighten the contract

You already have the strongest piece: a structured `DesignLanguageSpec` (W3C tokens +
DESIGN.md) that's injected into screen/component prompts. Ways to make it bite harder:

- **Token linting on generated output.** After a screen is generated, scan the TSX for
  raw hex/rgb and arbitrary Tailwind values (`text-[#...]`, `p-[13px]`). Flag them and
  offer a one-click "snap to nearest token" fix. The prompt *asks* for tokens; a linter
  *enforces* them. This is the difference between "usually on-brand" and "always."
- **Component contracts, not just color tokens.** Your spec has per-component `do/don't`.
  Feed the actual shadcn component *signatures* you support into the prompt as a typed
  catalog (you partially do this with `SHADCN_COMPONENT_CATALOG`) — then validate imports
  against it so the model can't invent `<FancyButton>`.
- **A "design diff" when switching themes.** When the user changes the default design
  language, show which screens will visually change and offer batch re-style (a workflow:
  for each screen → Style node with new tokens → validate). Today switching themes is
  silent.
- **Visual regression thumbnails.** Cache a screenshot per screen. After a re-style or
  edit, show before/after side by side. Cheap to do via the Runner's iframe.
- **Design tokens as the single source for the *app itself*** — the spec's `motion`,
  `spacing`, `radii` facets are defined but (from the code) mostly inform color/type.
  Wire spacing/radii/shadow/motion tokens into the generated `globals.css` and the prompt
  so generated apps inherit *rhythm*, not just palette.

---

## 4. Screens & components: prompt engineering upgrades

- **Few-shot from the user's own library.** When generating a new screen, retrieve the
  2–3 most similar saved components/screens (by tag/embedding) and inject them as
  exemplars: "match this house style." This makes output #5 look like outputs #1–4 — the
  thing that makes a generator feel like *yours*.
- **A structured plan step that the user can edit.** Before generating code, emit a short
  JSON/markdown plan (layout regions, components used, data needed, routes touched) and
  let the user tweak it. Cheaper than regenerating code, and it's where most "that's not
  what I meant" is caught. Your Architect node already does this for workflows — bring it
  into the interactive Screens chat.
- **Streaming structured edits, not full-file rewrites.** The update prompt already
  pushes `edit_file` over `write_file` — surface that in the UI as a live diff the user
  accepts/rejects hunk by hunk (like an AI code review), so a small change can't nuke a
  working screen.
- **"Explain this screen" / reverse prompt.** Given a screen's code, generate the prompt
  that would recreate it. Great for turning a hand-tweaked screen back into a reusable
  generation recipe.
- **Image attachments → layout extraction.** When a vision model gets a screenshot,
  run a dedicated "extract layout spec" pass first (regions, hierarchy, components) and
  feed *that* structured spec into generation, rather than the raw image into the code
  model. More reliable than hoping one pass does both.

---

## 5. Fonts & typography (you asked specifically)

Typography is the fastest way generated apps stop looking generic. Concrete integrations:

- **Bundle a curated font catalog**, not a free-text family name. Group by role so the
  design-language generator picks *intentionally*:
  - *Geometric sans* — Geist, Inter, Plus Jakarta Sans, Hanken Grotesk
  - *Humanist sans* — Source Sans, IBM Plex Sans, Figtree
  - *Display / editorial* — Fraunces, Instrument Serif, Bricolage Grotesque, Clash Display
  - *Serif text* — Newsreader, Source Serif, Lora
  - *Mono* — Geist Mono, JetBrains Mono, IBM Plex Mono, Commit Mono
- **Pre-pair fonts.** Ship ~12 vetted display+text+mono trios ("Fraunces / Geist / Geist
  Mono"). Let the model pick a pairing by name instead of choosing three families
  independently (which usually clashes). Store pairings in the spec's `typography.fonts`.
- **Self-host via Fontsource** (you already use `@fontsource-variable/geist`). For each
  chosen family, add the matching `@fontsource-variable/*` import to the generated app so
  it works offline in the Tauri sandbox — don't rely on Google Fonts CDN at runtime.
- **Generate a real type scale, not just a family.** The spec already has `scale`,
  `weights`, `leading`, `tracking`. Render a live specimen in the Design tab (you now
  have the start of this) and emit Tailwind `@theme` `--text-*` tokens so generated
  screens use `text-2xl` consistently.
- **Variable-font axes as tokens.** For families like Fraunces/Geist, expose `opsz`,
  `wght`, `slnt` as motion-able tokens — e.g. headings at high optical size — for a
  genuinely bespoke feel that flat font choices can't match.
- **Fonts in the Tweaks/preview layer** so the user can A/B a pairing on a real screen
  before committing it to the design language.

---

## 6. APIs: from definition to typed, mocked, wired

The proxy + service-hook approach is solid. To make it end-to-end:

- **Generate a typed client + Zod schema** from each endpoint's example response, so
  generated screens get autocomplete and runtime validation, not `any`.
- **Auto-mock from the schema** so screens render with realistic data *before* real keys
  are added — and the user can flip a switch from "mock" to "live."
- **Show which screens consume which API** (a small dependency view, reusing Flows'
  graph). Deleting/renaming an endpoint then warns about downstream breakage.
- **cURL/OpenAPI import → endpoint picker → "attach to screen"** in two clicks, dropping
  the `<!-- @API -->` mention into the chat composer for you.

---

## 7. Cross-cutting polish

- **Command palette (⌘K):** jump to any screen/component/theme/node, run a workflow, or
  switch model. A 9-tab app lives or dies by fast navigation.
- **Global model strategy, per-node override.** Let users set "cheap model for
  transform/summarize, strong model for structure/architect" once, with per-node
  overrides (the data model already supports `systemPrompt`/model per node). Surface the
  effective model on each node.
- **Diff-based undo across the whole project**, not just per-file — generation touches
  multiple files (page + service + router); undo should too. Tie it to `gitop` so every
  run is a commit you can roll back.
- **Empty states that teach.** Each tab's first-run should show one worked example and a
  "start from template" — the Workflow templates are perfect for this; surface them on an
  empty canvas instead of a blank grid.
- **Accessibility pass on generated output:** a `validate`-style node that runs axe on
  the rendered screen and feeds violations back into a fix loop. "Generates accessible
  apps" is a strong differentiator.

---
