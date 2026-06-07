# Plan: Wire Skills into the UI

## Context

The `skill` agent tool (`src-tauri/src/agent/executor/skill.rs`) is fully implemented and registered in every panel's tool filter (`GENERIC_AGENT_TOOLS` in `agentToolDefaults.ts`), but it is **completely invisible in the UI**:

- There is no way to create/edit a `SKILL.md` from the app — a user has to hand-author `projects/{id}/.prototyper/skills/<name>/SKILL.md` outside Prototyper.
- There is no way to *see* what skills exist in a project.
- The model has no discovery mechanism either — the only hint it gets is the one-line `<available-deferred-tools>` description (`deferred_tools.rs:18-34`); if it guesses a wrong skill name, the error message says "List `{project_dir}/.prototyper/skills/` to see available skills," which it can technically do via filesystem tools, but this is indirect and token-wasteful compared to just telling it what exists.

This plan closes all three gaps end-to-end, incorporating two concrete suggestions — list skills in the Library panel, and reference them in chat via `@` — plus the model-discovery piece those two UI surfaces depend on for their data.

`SKILL.md` is structurally identical to a Plan document (markdown + YAML frontmatter, one file per named entity, project-scoped), so this plan reuses Plans' editor infrastructure rather than building a parallel one.

---

## 1. Skill creation & editing (foundation — the other three pieces need skills to exist first)

Mirror the existing `"plan"` case in `SidebarRail.tsx`'s `handleCreate` (~line 107-156):

- Add a `"skill"` branch: prompt for a name, sanitize to kebab-case (matches the `name` validation in `skill.rs:40` — `[a-z0-9]+(-[a-z0-9]+)*`, ≤64 chars), write `projects/{id}/.prototyper/skills/<name>/SKILL.md` with starter frontmatter (`name`, `description`), dispatch `prototyper:tree-changed`, open the new file.
- Reuse `PlanEditor`/`PlanLayout`/`FrontmatterHeader` for the editing surface — give it a 2-field frontmatter schema (`name`, `description`) instead of Plans' richer one (`PlanFrontmatterSchema` in `frontmatter.ts` is the pattern to mirror with a smaller `SkillFrontmatterSchema`).
- This can live as a new lightweight panel/route, or as a mode within the Library panel's detail view (see §3) — either way, it's the same `PlanEditor`-based component with a different frontmatter schema and a different save path (`.prototyper/skills/<name>/SKILL.md` instead of `plans/{slug}.md`).

**Files**: `src/layout/SidebarRail.tsx`, new `src/panels/skills/` (or similar) housing a thin wrapper around `PlanEditor`/`PlanLayout`/`FrontmatterHeader`, new `SkillFrontmatterSchema` alongside `PlanFrontmatterSchema` in (or next to) `frontmatter.ts`.

---

## 2. Model-facing skill discovery

Currently the model only learns a skill exists by guessing its name or browsing the filesystem. Replace that with an explicit enumeration appended to the existing deferred-tools system message, the same place/shape `deferred_tools_system_message` (`deferred_tools.rs:18-34`) already builds its `<available-deferred-tools>` block:

- When `skill` is among the deferred names for a panel, scan `projects/{id}/.prototyper/skills/*/SKILL.md`, parse each with the same `gray_matter`-based `parse_frontmatter` that `skill.rs` already has (extract just `name` + `description`, skip malformed entries rather than failing the whole turn), and append a short `<available-skills>` block listing `name: description` pairs.
- This is the natural extension of the mechanism that already exists — no new event types, no new IPC, no new `AppState`. It runs server-side, in Rust, at the same point the deferred-tools message is assembled (`agent_loop.rs`, where `deferred_tools_system_message` is called).
- If the skills directory doesn't exist or is empty, emit nothing extra (mirrors `deferred_tools_system_message`'s `None` early-return for the empty case).

**Files**: `src-tauri/src/agent/deferred_tools.rs` (add a sibling function, e.g. `available_skills_system_message`, called alongside `deferred_tools_system_message` wherever that's invoked in `agent_loop.rs`), reuse `parse_frontmatter` from `skill.rs` (make it `pub(in crate::agent)` if it isn't already accessible).

---

## 3. Library panel: list skills

`LibraryPanel.tsx` already has the exact dual-view (list/gallery), filter-pill, search, and row-action (delete/duplicate/export/rename) infrastructure for exactly this kind of per-project named-entity collection (`src/panels/library/types.ts`, `LibraryItems.tsx`).

- Add `"skill"` to `ItemType` (`library/types.ts:3`) and to `TYPE_COLORS`/`TYPE_BG`/`TYPE_LABELS`/`ALL_TYPES`.
- In `LibraryPanel`'s `queryFn` (lines 41-79), add a `.prototyper/skills` entry to the scan: `readDir` the directory, and for each subdirectory read+parse its `SKILL.md` frontmatter (frontend-side, via `js-yaml` — exactly like `frontmatter.ts` does for plans, just with a 2-field schema) to populate `name`/`description`. This mirrors how the `theme` branch reads `theme.css` for its palette (lines 70-72) — same "read the directory, then read inside each entry for richer metadata" shape.
- `openItem` (line 103) gets a `"skill"` branch that opens the skill editor from §1.
- Delete/duplicate/rename/export reuse the existing generic handlers — they already operate on `LibraryItem` by `type`+`id`+`path` convention; only the path-construction needs a `"skill"` case (mirrors the `component`/`screen`/`theme` directory convention: `.prototyper/skills/{id}/`).

**Files**: `src/panels/library/types.ts`, `src/panels/LibraryPanel.tsx`, `src/panels/library/LibraryItems.tsx` (icon for the new type — follow the existing `TYPE_ICONS`-style `Record<ItemType, ReactNode>` pattern there).

---

## 4. Chat `@` mention: reference skills

This is the **global chat-input mention system** (`MentionPicker.tsx` + `ChatInput.tsx` + `MentionAsset`/`PickerItem` types) — distinct from the Plans-editor-only `@kind/name` autocomplete in `lib/markdown/mentions.ts` (which is scoped to the Plans markdown editor and has its own separate `MentionKind` union; not the right place for this).

- Add `"skill"` to the `MentionAsset["type"]` union (`types/chat.ts`) and a `TYPE_ICONS.skill` entry in `MentionPicker.tsx:16`.
- In `loadProjectAssets` (`MentionPicker.tsx:135-228`), add a skills block following the same shape as the Themes block (lines 167-187: `readDir` the collection, then read a per-entry file for richer metadata) — `readDir(.prototyper/skills)`, then for each subdirectory `readFile` its `SKILL.md`, parse frontmatter (same `js-yaml` 2-field parse as §3 — share the helper rather than duplicating it), and push `{ id: name, type: "skill", name, description: <frontmatter description>, path: <SKILL.md path> }`.
- No `preCode` — let `handleMentionSelect` (`ChatInput.tsx:79-92`) fall through to its existing `readFile(item.path)` branch, attaching the full `SKILL.md` content (frontmatter + body) as `code`. This is consistent with how `component`/`screen`/`theme`/`file` mentions work today (lazy file read on selection) and needs no changes to `ChatInput.tsx` itself.

**Files**: `src/types/chat.ts` (or wherever `MentionAsset` lives), `src/components/chat/MentionPicker.tsx`.

---

## Shared helper (used by §3 and §4)

Both the Library listing and the chat mention picker need to parse `SKILL.md` frontmatter on the frontend. Add a small `parseSkillFrontmatter(content: string): { name?: string; description?: string }` helper (e.g. in `lib/markdown/` next to `frontmatter.ts`) using `js-yaml` directly on the `---`-delimited block — a minimal 2-field counterpart to `PlanFrontmatterSchema`, not a full reuse of the Plans schema (Skills' frontmatter is intentionally smaller per the spec). Both call sites import this one function instead of each hand-rolling YAML extraction.

**Files**: new `src/lib/markdown/skillFrontmatter.ts` (or a named export added to `frontmatter.ts`).

---

## Build order

1. **Skill creation/editing** (§1) — nothing else is testable without a way to create a `SKILL.md` from the app.
2. **Shared frontmatter helper** (shared dependency for §3 and §4).
3. **Library listing** (§3) and **chat mention** (§4) can proceed in parallel — they touch disjoint files and both depend only on §1+helper.
4. **Model-facing discovery** (§2) — independent of the frontend pieces (pure Rust, agent-loop side); can be done any time, but ordering it last means there will be real skills in a test project to enumerate when verifying it.

---

## Verification

1. `bunx tsc --noEmit` and `cargo check` after each piece.
2. Manual smoke test via `bun run tauri:dev`:
   - Create a skill through the new UI; confirm `SKILL.md` lands at `.prototyper/skills/<name>/SKILL.md` with valid frontmatter.
   - Confirm it appears in the Library panel's list/gallery views, with correct name/description/icon, and that delete/rename/duplicate work.
   - Open a chat in any panel, type `@`, confirm the skill appears in the picker with its description, and that selecting it attaches the `SKILL.md` content as a mention.
   - Drive an agent turn in a panel where `skill` is registered; confirm the system prompt now contains an `<available-skills>` block listing the created skill, and that the model can call `skill` with the correct name without first browsing the filesystem.
3. `cargo clippy` / eslint clean, no `any`, per coding-standards.md.
