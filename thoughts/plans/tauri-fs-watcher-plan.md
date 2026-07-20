# Plan: Replace `prototyper:tree-changed` with `tauri-plugin-fs` watcher

## Problem

`prototyper:tree-changed` is a plain browser `CustomEvent` on `window` — 9 sites
using the raw string literal, no shared constant, no central definition. It's a
fragile implicit contract: a typo in any one site silently breaks that path.
It also only fires when our own code dispatches it — external filesystem
changes (editor, git checkout, scaffold tools) go undetected.

## Solution

Use `tauri-plugin-fs`'s `watch` (debounced) to watch `projects/{project}/`
recursively. The OS-level file watcher pushes events to the frontend; a single
watcher maps each event's path to a section and invalidates the corresponding
cache. No more `window.dispatchEvent`, no more scattered manual invalidation
calls for filesystem-driven changes.

`tauri-plugin-fs` is already installed (Cargo.toml + package.json) and the
`fs:allow-watch` permission is already in `capabilities/default.json`. The
existing `SidebarFilesTab` already uses `watch` with `BaseDirectory.AppData`
(line 62-69), so the pattern is proven in this codebase.

## Debounce

`delayMs: 100`. The model does not write 200 files in one second — 100ms is
enough to coalesce a scaffold burst (a handful of rapid writes) into one
invalidation per section, without the 500ms lag of the SidebarFilesTab
precedent. Snappy enough for UX, debounced enough to avoid per-file
invalidation spam.

## Architecture

```
OS filesystem change
  → tauri-plugin-fs watch (100ms debounce)
  → WatchEvent { paths: string[] }
  → projectWatcher maps path → SectionName
  → invalidate react-query tree cache for that section
  → (themes) reload Zustand themesStore
  → ProjectExplorer / ContextToolbar / PreviewChrome re-render
```

One watcher per active project. Lifecycle tied to `appStore.setSettings` —
when `project` changes, stop the old watcher, start the new one. No useEffect
in panels; no window events.

## Files

### New: `src/lib/sections.ts` (~15 lines)

Move `SECTION_NAMES`, `SectionName`, `SECTION_TREE_PATH` here from
`ProjectExplorer.tsx`. Re-export from `ProjectExplorer.tsx` for backward
compat. Prevents circular deps: `projectWatcher.ts` needs the constants,
`ProjectExplorer.tsx` consumes the watcher's invalidation indirectly.

### New: `src/lib/projectWatcher.ts` (~50 lines)

```typescript
import { watch, BaseDirectory, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { useThemesStore } from "@/stores/themesStore";
import { SECTION_NAMES, SECTION_TREE_PATH, type SectionName } from "@/lib/sections";

let currentUnwatch: UnwatchFn | null = null;

function sectionFromPath(projectId: string, fullPath: string): SectionName | null {
  const normalized = fullPath.replace(/\\/g, "/");
  const prefix = `projects/${projectId}/`;
  const idx = normalized.indexOf(prefix);
  if (idx === -1) return null;
  const afterPrefix = normalized.slice(idx + prefix.length);
  const section = afterPrefix.split("/")[0];
  return (SECTION_NAMES as readonly string[]).includes(section)
    ? (section as SectionName)
    : null;
}

export async function startProjectWatcher(projectId: string): Promise<void> {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
  if (!projectId) return;
  currentUnwatch = await watch(
    `projects/${projectId}`,
    (event) => {
      for (const rawPath of event.paths) {
        const section = sectionFromPath(projectId, rawPath);
        if (!section) continue;
        queryClient.invalidateQueries({
          queryKey: projectKeys.tree(projectId, SECTION_TREE_PATH[section]),
        });
        if (section === "themes") {
          useThemesStore.getState().loadThemes(projectId);
        }
      }
    },
    { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 100 },
  );
}

export function stopProjectWatcher(): void {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
}
```

### `src/stores/appStore.ts` — restart watcher on project switch

In `setSettings`, when `patch.project` changes and the new project loads,
also call `startProjectWatcher(patch.project)`. The `UnwatchFn` ref lives in
module-level state inside `projectWatcher.ts` (not in the Zustand store — it's
a function ref, not serializable state).

Two call sites in appStore:
- `init()` (line 188) — after `loadProject(loaded.project)`, also
  `startProjectWatcher(loaded.project)`
- `setSettings` (line 207) — after `loadProject(patch.project)`, also
  `startProjectWatcher(patch.project)`

### `src/components/ProjectExplorer.tsx` — re-export constants

Move `SECTION_NAMES`, `SectionName`, `SECTION_TREE_PATH` to
`src/lib/sections.ts`. Re-export from ProjectExplorer for the existing
import sites (`SidebarRail.tsx`, `PlansPanel.tsx`):

```typescript
export { SECTION_NAMES, type SectionName, SECTION_TREE_PATH } from "@/lib/sections";
```

### Remove `prototyper:tree-changed` dispatchers (6 sites)

- `src/panels/PlansPanel.tsx:84` — delete the `window.dispatchEvent`
- `src/panels/create/modes/ComponentsMode.tsx:309` — delete the dispatch
- `src/panels/create/modes/ThemesMode.tsx:217, 260, 288` — delete the 3
  dispatches

These were needed because the model writes files via `write_file` IPC and the
frontend had no other way to know. The watcher now catches those writes
directly.

### Remove `prototyper:tree-changed` listeners (2 sites)

- `src/layout/SidebarRail.tsx:52-67` — delete the entire `useEffect` listener
  block. The watcher handles external/model-driven changes now.
- `src/stores/themesStore.ts:53-59` — delete the module-level
  `window.addEventListener`. The watcher calls `loadThemes` directly.

### `src/layout/SidebarRail.tsx` — `invalidateSection` reverts to direct invalidation

`invalidateSection` (line 94-96) currently dispatches `prototyper:tree-changed`.
Revert to direct `queryClient.invalidateQueries` for immediate UX on sidebar
create/delete/rename (the watcher's 100ms debounce is fine for external
changes, but sidebar actions should feel instant). The watcher will also fire
~100ms later — react-query dedupes, no harm.

```typescript
const invalidateSection = (section: SectionName) => {
  queryClient.invalidateQueries({
    queryKey: projectKeys.tree(settings.project, SECTION_TREE_PATH[section]),
  });
};
```

### `src/panels/create/modes/WizardMode.tsx:97` — keep as-is

The direct `queryClient.invalidateQueries({ queryKey: projectKeys.tree(project,
"screens") })` after `register_screen` stays — immediate invalidation for
snappy UX. The watcher fires ~100ms later; react-query dedupes.

## Path mapping

`watch` with `BaseDirectory.AppData` returns absolute paths in `event.paths`.
The watcher maps each path to ALL relevant query keys — not just tree
queries, but also per-file queries (`themeCss`, `componentCode`, `file`).
One watcher, all caches invalidated. No partial coverage.

### Path → query key mapping

| Path pattern | Query key invalidated | Hook affected |
|---|---|---|
| `projects/{p}/themes/{name}/theme.css` | `projectKeys.themeCss(p, name)` | `useThemeCss` |
| `projects/{p}/generated/src/components/{name}/component.tsx` | `projectKeys.componentCode(p, name)` | `useComponentCode` |
| `projects/{p}/apis/apis.json` | `projectKeys.file(p, "projects/{p}/apis/apis.json")` | `useFileWatcher` |
| `projects/{p}/{section}/**` | `projectKeys.tree(p, section)` | `useFlatProjectTree` |
| `projects/{p}/themes/**` | (also) `useThemesStore.loadThemes(p)` | Zustand themes store |

The watcher inspects each event path and invalidates every matching key.
A single `theme.css` write invalidates both `themeCss` and `tree(themes)` and
reloads the Zustand store. A `component.tsx` write under `generated/` (not a
tree section) still invalidates `componentCode` via the path-specific match.

### `src/lib/projectWatcher.ts` — full mapping logic

```typescript
import { watch, BaseDirectory, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { useThemesStore } from "@/stores/themesStore";
import { SECTION_NAMES, SECTION_TREE_PATH, type SectionName } from "@/lib/sections";

let currentUnwatch: UnwatchFn | null = null;

function invalidateForPath(projectId: string, fullPath: string): void {
  const normalized = fullPath.replace(/\\/g, "/");
  const prefix = `projects/${projectId}/`;
  const idx = normalized.indexOf(prefix);
  if (idx === -1) return;
  const afterPrefix = normalized.slice(idx + prefix.length);
  const segments = afterPrefix.split("/");

  // Per-file queries — match specific file paths
  if (segments[0] === "themes" && segments[2] === "theme.css") {
    queryClient.invalidateQueries({ queryKey: projectKeys.themeCss(projectId, segments[1]) });
  }
  if (segments[0] === "generated" && segments[1] === "src" && segments[2] === "components"
      && segments[4] === "component.tsx") {
    queryClient.invalidateQueries({ queryKey: projectKeys.componentCode(projectId, segments[3]) });
  }
  if (segments[0] === "apis" && segments[1] === "apis.json") {
    queryClient.invalidateQueries({ queryKey: projectKeys.file(projectId, `projects/${projectId}/apis/apis.json`) });
  }

  // Tree queries — match by section (first segment)
  const section = segments[0];
  if ((SECTION_NAMES as readonly string[]).includes(section)) {
    queryClient.invalidateQueries({ queryKey: projectKeys.tree(projectId, SECTION_TREE_PATH[section as SectionName]) });
    if (section === "themes") {
      useThemesStore.getState().loadThemes(projectId);
    }
  }
}

export async function startProjectWatcher(projectId: string): Promise<void> {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
  if (!projectId) return;
  currentUnwatch = await watch(
    `projects/${projectId}`,
    (event) => {
      for (const rawPath of event.paths) {
        invalidateForPath(projectId, rawPath);
      }
    },
    { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 100 },
  );
}

export function stopProjectWatcher(): void {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
}
```

### Remove manual per-file invalidations (3 sites)

With the watcher catching every `write_file`, these manual
`queryClient.invalidateQueries` calls become redundant — the watcher fires
~100ms later and react-query dedupes. Remove them:

- `src/panels/create/modes/ThemesMode.tsx:100` — `persistTheme` invalidates
  `themeCss` after writing `theme.css`. Watcher catches it.
- `src/panels/create/modes/ThemesMode.tsx:132` — `persistThemeFile`
  invalidates `themeCss` after writing `theme.css`. Watcher catches it.
- `src/panels/create/modes/ComponentsMode.tsx:234` — `handleApplyCode`
  invalidates `componentCode` after writing `component.tsx`. Watcher catches
  it.

Keep the `library` invalidation at `ComponentsMode.tsx:236` — that's a
different query (`projectKeys.library`) for the saved-components library,
not a file the watcher tracks under `projects/{p}/components/`.

### `src/panels/create/modes/WizardMode.tsx:97` — keep as-is

The direct `queryClient.invalidateQueries({ queryKey: projectKeys.tree(project,
"screens") })` after `register_screen` stays — immediate invalidation for
snappy UX. The watcher fires ~100ms later; react-query dedupes.

## Edge cases

- **Project switch**: `startProjectWatcher` stops the old watcher before
  starting the new one. Stale events from the old project's watcher (in
  flight during the async stop) target a project that's no longer active —
  `sectionFromPath` uses the new `projectId`, so old-project paths return
  null and are ignored.
- **App startup**: `appStore.init()` starts the watcher after loading the
  project.
- **App teardown**: Tauri handles process cleanup; no explicit stop needed.
- **`generated/` writes**: `generated` is not in `SECTION_NAMES`, so
  scaffold writes don't trigger tree invalidation. But
  `generated/src/components/{name}/component.tsx` writes DO trigger
  `componentCode` invalidation via the per-file path match. Correct —
  `useComponentCode` reads from `generated/`, the watcher catches it.
- **`apis.json` writes**: the watcher catches `projects/{p}/apis/apis.json`
  and invalidates `projectKeys.file` — `useFileWatcher` in
  `ContextToolbar`/`ScreensMode`/`ComponentsMode` refetches. Previously
  this was a gap (manual invalidation only); now it's automatic.

## Verification

- `bunx tsc --noEmit`
- `bunx eslint` on touched files
- Manual:
  1. Create a theme from sidebar → tree updates instantly (direct
     invalidation) + watcher fires ~100ms later (no-op, already fresh).
  2. Create a theme from ThemesMode chat (model writes via `write_file`) →
     watcher fires ~100ms later → tree updates. No manual dispatch needed.
  3. External editor creates a file in `projects/x/screens/` → watcher fires
     → tree updates. (NEW capability — previously undetected.)
  4. Switch projects → old watcher stops, new starts. Create in new project
     → updates correctly.

## Not in scope

- Moving `screens`/`components`/`workflows`/`apis`/`plans` to Zustand —
  earlier directive was themes-only; this refactor keeps react-query for
  those sections, the watcher just invalidates them.
- `useGitStatus` / `useGitMutations` — git queries use a separate query key
  namespace (`gitKeys`), invalidated by git operations, not filesystem
  writes. The watcher could invalidate them on `.git/` changes but that's
  a different concern.
- `useModelCapabilities` — fetches from Ollama/Anthropic APIs, not
  filesystem.