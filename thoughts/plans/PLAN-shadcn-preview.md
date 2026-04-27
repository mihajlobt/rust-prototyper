# Plan: shadcn Component Generation & Vite Preview

## Executive Summary

Replace the in-process Babel+Frame component preview with a unified Vite dev server approach, enabling AI-generated components to use shadcn/ui components with real imports. Add a user toggle for shadcn-aware vs raw Tailwind generation. All 18 installed shadcn primitives become available in the generated project.

---

## Current State

- **Component Preview**: Uses `react-frame-component` + in-browser Babel compilation (`preview.tsx`). All imports are stripped; React/icons injected via `window.parent.__*`. No real import resolution.
- **Runner Preview**: Uses a real Vite dev server on port 5173 via `<iframe src={devUrl}>`. Has HMR, full import resolution.
- **AI Prompts**: Instruct the model to write zero-import components with inline Tailwind. "NO import statements of any kind."
- **Themes**: CSS custom properties injected as `<style>` in the Frame `head` prop. shadcn token format already supported in theme generation prompts.
- **Scaffold**: `scaffoldGenerated()` creates a bare Vite+React+TS project with only the icon library added. No shadcn, no Tailwind config, no path aliases.

---

## Architecture Overview

```
Before:
  ComponentsPanel → Babel compile → Frame (iframe + parent CSS injection)
  RunnerPanel     → Vite dev server → <iframe src={devUrl}>

After:
  ComponentsPanel → Write component.tsx + theme.css to component-preview/ → Vite dev server renders directly
  RunnerPanel     → Vite dev server from generated/ → <iframe src={devUrl}>

Separate directories:
  component-preview/  → Bun/Vite project for component preview (separate from generated/)
                        App.tsx imports Generated.tsx component directly
                        → shadcn components in src/components/ui/
                        → path aliases for @/ imports
  generated/          → Bun/Vite project for Runner panel (unchanged from current, plus shadcn setup)

Separate dev servers:
  ComponentPreview → Vite instance on configurable port (default: 5173), started from component-preview/
  Runner           → Vite instance on configurable port (default: 5174), started from generated/

Settings:
  devServerPort    → configurable port for component preview dev server (default: 5173), stored in projectSettingsStore (per-project)
  runnerPort       → configurable port for Runner panel dev server (default: 5174), stored in projectSettingsStore (per-project)

Key insight: Since the Vite dev server already renders the scaffolded app (which imports the Generated component),
the component IS rendered directly by Vite. No separate iframe or preview entry point needed in ComponentsPanel.
The component preview runs from its own component-preview/ directory with its own dev server.
```

---

## Phase 1: Scaffold Enhancement for shadcn

**Goal**: The component preview has its own `component-preview/` Bun/Vite project with shadcn/ui components, Tailwind config, path aliases. The `generated/` directory also gets shadcn setup for the Runner panel.

### 1.1 Create `scaffoldComponentPreview()` in `src/lib/scaffold.ts`

A new function that scaffolds the component preview project in `component-preview/` (a sibling directory to `generated/` under the project data dir). Uses **bun commands** (same approach as Runner panel) and the official shadcn CLI.

Steps:

**Step 1: Create Vite project**

```bash
bun create vite component-preview --template react-ts
```

- Ref: [Bun Vite guide](https://bun.com/docs/guides/ecosystem/vite) — `bun create vite` scaffolds a Vite project

**Step 2: Install dependencies**

```bash
cd component-preview && bun install
```

- Ref: [Bun install docs](https://bun.com/docs/guides/install/add) — installs dependencies from package.json

**Step 3: Initialize shadcn in the component-preview project**

Run `shadcn init` with the Vite template, pointing `--cwd` at the component-preview directory:

```bash
bunx --bun shadcn@latest init -t vite --defaults --yes --cwd {componentPreviewDir}
```

- Ref: [shadcn CLI docs — init command](https://ui.shadcn.com/docs/cli) — `init -t vite` scaffolds for Vite, `--defaults` uses default configuration (nova preset), `--yes` skips confirmation, `--cwd` sets working directory
- Ref: [shadcn Vite installation guide](https://ui.shadcn.com/docs/installation/vite) — confirms `bunx --bun shadcn@latest init -t vite` as the correct Vite init command
- This automatically installs `class-variance-authority`, `clsx`, `tailwind-merge`, all required `@radix-ui/*` packages, creates `src/lib/utils.ts` with `cn()`, writes `components.json`, and configures path aliases in `tsconfig.json` and `vite.config.ts`

**Step 4: Add shadcn components**

Run `shadcn add` with all 18 component names, pointing `--cwd` at the component-preview directory:

```bash
bunx --bun shadcn@latest add avatar badge button card checkbox collapsible context-menu dialog dropdown-menu input label scroll-area select separator steps tabs textarea tooltip --yes --overwrite --cwd {componentPreviewDir}
```

- Ref: [shadcn CLI docs — add command](https://ui.shadcn.com/docs/cli) — `add [components...]` installs component files and their dependencies, `--yes` skips confirmation, `--overwrite` overwrites existing files, `--cwd` sets working directory
- This writes component `.tsx` files to `src/components/ui/` inside the component-preview directory, along with their Radix UI dependencies
- Ref: [bun docs — bunx](https://bun.com/docs/guides/ecosystem/vite) — `bunx` executes package binaries, `--bun` forces using Bun's runtime

**Step 5: Update `src/App.tsx`** to import the Generated component directly and handle dark mode + theme:

```tsx
import React from "react"
import "./styles/globals.css"
import "./styles/preview-theme.css"
import Generated from "./components/Generated"

function App() {
  const [dark, setDark] = React.useState(false)
  React.useEffect(() => {
    window.addEventListener("message", (e) => {
      if (e.data?.type === "set-dark") setDark(e.data.value)
    })
  }, [])
  return (
    <div className={dark ? "dark" : ""} style={{ minHeight: "100vh" }}>
      <Generated />
    </div>
  )
}

export default App
```

The Vite dev server renders this directly — the component IS the app. No separate preview entry point needed.

- Ref: [Vite docs — index.html and Project Root](https://vite.dev/guide/index.html) — HTML files serve as primary entry points; the app renders the Generated component directly

**Step 6: Write `src/styles/preview-theme.css`** — empty placeholder file (populated at runtime with the selected theme CSS)

**Step 7: Write `src/components/Generated.tsx`** — placeholder component:
```tsx
export default function Generated() {
  return <div style={{ padding: 24 }}>Generated component will appear here</div>
}
```

### 1.2 Update `scaffoldGenerated()` for Runner shadcn support

Apply the same shadcn CLI setup to the existing `generated/` directory (used by Runner panel). After the existing `bun create vite . --template react-ts` + `bun install` steps, add:

```bash
bunx --bun shadcn@latest init -t vite --defaults --yes --cwd {generatedDir}
bunx --bun shadcn@latest add avatar badge button card checkbox collapsible context-menu dialog dropdown-menu input label scroll-area select separator steps tabs textarea tooltip --yes --overwrite --cwd {generatedDir}
```

Same refs as Steps 3-4 above. This ensures the Runner's Vite project also has shadcn components available.

### 1.3 Create `src/lib/scaffold-shadcn.ts`

A new module that:
- Exports a list of shadcn component names (the 18 primitives) used by the `shadcn add` command
- Exports `SHADCN_COMPONENT_NAMES: string[]` — the list of components to pass to `bunx shadcn@latest add`
- Exports `getShadcnGlobalsCss()` — returns the CSS variables + theme block content from the main app's `globals.css`, for writing to the generated project
- Exports `getAppTsx()` — returns the `App.tsx` source code (imports Generated component, handles dark mode)
- Exports `getGeneratedPlaceholderTsx()` — returns the `Generated.tsx` placeholder source
- These are called by `scaffoldComponentPreview()` and `scaffoldGenerated()` during scaffolding

### 1.4 Scaffold Versioning

Add a `scaffold-version.json` to both `component-preview/` and `generated/` with `{ version: 2 }`. Update `hasViteScaffold()` to check this file's version. If version < 2, re-scaffold. This ensures existing projects get the shadcn setup.

Note: `bunx shadcn@latest init -t vite --defaults --yes --cwd {dir}` automatically:
- Writes `components.json` in the generated directory
- Configures `tsconfig.json` with `@/*` path aliases
- Configures `vite.config.ts` with `resolve.alias` for `@/`
- Installs all base dependencies (`class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`, `lucide-react`, etc.)
- Writes `src/lib/utils.ts` with the `cn()` utility
- Ref: [shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite) — confirms init handles all configuration

### 1.5 Doc References for Scaffold Phase

| Step | Reference |
|------|-----------|
| `bun create vite . --template react-ts` | [Bun Vite guide](https://bun.com/docs/guides/ecosystem/vite) — `bun create vite` scaffolds a Vite project |
| `bun install` | [Bun install docs](https://bun.com/docs/guides/install/add) — installs dependencies from package.json |
| `bunx --bun shadcn@latest init -t vite` | [shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite) — official Vite init command |
| `shadcn init` flags (`--defaults`, `--yes`, `--cwd`) | [shadcn CLI docs](https://ui.shadcn.com/docs/cli) — init command options |
| `bunx --bun shadcn@latest add [components]` | [shadcn CLI docs](https://ui.shadcn.com/docs/cli) — add command installs components |
| `shadcn add` flags (`--yes`, `--overwrite`, `--cwd`) | [shadcn CLI docs](https://ui.shadcn.com/docs/cli) — add command options |
| `bunx` / `bunx --bun` | [Bun docs](https://bun.com/llms-full.txt) — `bunx` executes package binaries |
| Multi-page HTML entry points | [Vite Multi-Page App guide](https://vite.dev/guide/build#multi-page-app) — reference for understanding Vite entry points (not used in this plan; single entry point) |
| Vite `resolve.alias` config | [Vite Shared Options — resolve.alias](https://vite.dev/config/shared-options#resolve-alias) — path alias configuration |
| Vite index.html entry | [Vite docs — index.html](https://vite.dev/guide/index.html) — HTML files serve as primary entry points for Vite applications |

---

## Phase 2: Component Preview via Vite Dev Server

**Goal**: ComponentsPanel uses its own Vite dev server (running from `component-preview/`) for preview instead of Babel+Frame.

### 2.1 Create `src/lib/dev-server-manager.ts`

A Zustand store that manages two Vite dev server instances:

```ts
interface DevServerState {
  previewStatus: "idle" | "starting" | "running" | "error"
  previewUrl: string | null
  runnerStatus: "idle" | "starting" | "running" | "error"
  runnerUrl: string | null
  startPreview: (componentPreviewDir: string, port?: number) => Promise<string>
  startRunner: (generatedDir: string, port?: number) => Promise<string>
  stopPreview: () => void
  stopRunner: () => void
}
```

Logic:
- `startPreview()`: If already running, return URL. If idle, call `bunDev()` with the configurable port (from `settings.devServerPort`, default 5173) on the `component-preview/` directory and capture the URL from terminal output. Set status to "starting" → "running". Port conflicts are detected by Vite — if the port is in use, Vite auto-increments; the URL captured from terminal output reflects the actual port used.
- `startRunner()`: Same but for the `generated/` directory, using `settings.runnerPort` (default: 5174).
- `stopPreview()` / `stopRunner()`: Kill the respective process, reset state.
- ComponentsPanel uses `startPreview()`; RunnerPanel uses `startRunner()`.
- The store subscribes to each process's output to detect the URL and HMR events.

### 2.2 Update `ComponentsPanel.tsx`

Replace the `<Frame>` + `createPreviewComponent()` approach with direct Vite dev server rendering from `component-preview/`:

1. **On mount / when component selected**: Ensure dev server is running via `devServerManager.startPreview(componentPreviewDir, settings.devServerPort)`. The dev server renders the Generated component directly via App.tsx.

2. **On code change**: Write component code to `component-preview/src/components/Generated.tsx`. HMR updates the rendered component automatically.

3. **On theme change**: Write theme CSS to `component-preview/src/styles/preview-theme.css`. HMR updates the preview.

4. **On dark mode toggle**: Send `postMessage({ type: "set-dark", value: isDark })` to the preview iframe (the iframe renders the Vite dev server output).

5. **Replace `<Frame>` with `<iframe>`** pointing at the dev server URL:
   ```tsx
   <iframe
     ref={previewIframeRef}
     src={previewUrl}
     className="w-full h-full"
     sandbox="allow-scripts allow-same-origin allow-forms"
   />
   ```
   This is the same approach as the current RunnerPanel — the Vite dev server renders the component directly. No Babel compilation, no Frame component.

6. **Device frame**: Same as current — constrain iframe container width (375/768/100%).

7. **Remove dependencies**: `react-frame-component` (no longer needed for component preview). `@babel/standalone` may still be needed by Themes panel's `buildPreviewDoc` — evaluate.

8. **Remove `createPreviewComponent()` usage** — no longer needed for ComponentsPanel. Keep `buildPreviewDoc()` for Themes panel.

### 2.3 Update `RunnerPanel.tsx`

1. Use `devServerManager.startRunner()` instead of managing its own `bunDev()` process. Call `devServerManager.startRunner(generatedDir, settings.runnerPort)`.
2. The Runner iframe points to `${runnerUrl}/` (the Vite app running from `generated/`).
3. Keep the file tree, terminal, and code editor features.

### 2.4 Preview Lifecycle

| Event | Action |
|-------|--------|
| ComponentsPanel opens | `devServerManager.startPreview(componentPreviewDir, port)` if idle |
| Component code changes | Write to `component-preview/src/components/Generated.tsx` → HMR |
| Theme changes | Write to `component-preview/src/styles/preview-theme.css` → HMR |
| Dark mode toggle | `postMessage` to preview iframe |
| Device frame change | CSS width on container (no reload) |
| ComponentsPanel closes | Keep preview server running (user may re-open panel) |
| RunnerPanel opens | `devServerManager.startRunner(generatedDir, port)` if idle |
| RunnerPanel closes | Keep runner server running (user may re-open panel) |
| Project closes | `devServerManager.stopPreview()` + `devServerManager.stopRunner()` |

### 2.5 Doc References for Vite Preview Phase

| Step | Reference |
|------|-----------|
| Vite dev server | [Vite Features — Dev Server](https://vite.dev/guide/features) — Vite serves the app directly; the Generated component is rendered by the scaffolded App.tsx |
| Vite CSS HMR | [Vite Features — CSS](https://vite.dev/guide/features#css) — Vite supports CSS HMR natively, edits to imported CSS files update without full reload |
| `postMessage` for iframe communication | [MDN — Window.postMessage()](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage) — cross-origin iframe messaging |

---

## Phase 3: AI Prompt Updates

**Goal**: AI generates shadcn-aware components when the toggle is on; raw Tailwind when off.

### 3.1 Add `shadcnMode` and Port Settings

In `src/stores/projectSettingsStore.ts`, add to the `ProjectSettings` interface:
```ts
shadcnMode: boolean  // default: true
devServerPort: number  // default: 5173
runnerPort: number  // default: 5174
```

These are **per-project** settings (stored in `project-{projectId}.json`), not global. Different projects may use different ports. The `shadcnMode` is per-project because different projects may want different generation modes.

This persists in the Tauri Store per-project alongside other project settings like `stylePreset` and `directories`.

Note: `shadcnMode` is per-project rather than global because it affects the AI prompt, which should be project-specific (one project may use shadcn components while another uses raw Tailwind). This is analogous to how `stylePreset` is per-project.

### 3.1a Add Port Settings UI in Settings Modal

Add two number inputs in the Settings modal under a "Dev Server" section:
- **Component Preview Port**: defaults to 5173, bound to `projectSettings.devServerPort`
- **Runner Port**: defaults to 5174, bound to `projectSettings.runnerPort`
- When changed, the dev server must be restarted to pick up the new port (show a note in the UI)

### 3.2 Update `src/lib/prompts.ts`

Add a new section `SHADCN_COMPONENT_CATALOG` (lines ~100 area):

```
AVAILABLE SHADCN/UI COMPONENTS — import from "@/components/ui/{name}":
- avatar: Avatar, AvatarImage, AvatarFallback — user profile images
- badge: Badge, badgeVariants — status indicators, tags
- button: Button, buttonVariants — primary actions (variants: default, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, icon)
- card: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter — content containers
- checkbox: Checkbox — boolean input
- collapsible: Collapsible, CollapsibleTrigger, CollapsibleContent — expand/collapse sections
- context-menu: ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut — right-click menus
- dialog: Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose — modal overlays
- dropdown-menu: DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator — dropdown selections
- input: Input — text input fields
- label: Label — form field labels
- scroll-area: ScrollArea, ScrollBar — scrollable containers
- select: Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel — dropdown selects
- separator: Separator — visual dividers
- steps: Steps — step indicators
- tabs: Tabs, TabsList, TabsTrigger, TabsContent — tabbed navigation
- textarea: Textarea — multi-line text input
- tooltip: Tooltip, TooltipTrigger, TooltipContent, TooltipProvider — hover info

UTILITY:
- import { cn } from "@/lib/utils" — combines clsx + tailwind-merge for conditional classes
```

### 3.3 Update `COMPONENT_NEW_PROMPT_BASE`

When `shadcnMode` is ON, use a new prompt variant:

```
You are an expert React/TypeScript developer generating focused, reusable UI components using shadcn/ui.
This is a COMPONENT preview — NOT a full-page app generator. The preview area is max 400px wide.

[SHADCN_COMPONENT_CATALOG]

TOOL USAGE — REQUIRED:
You MUST call the write_file tool. The content argument is the raw source code written directly to a file.

CRITICAL — THE content PARAMETER IS RAW CODE, NOT JSON:
  WRONG — NEVER wrap code in a JSON object:
    write_file(content='{"commentary":"I built...", "title":"...", "code":"function App()..."}')
  CORRECT — content is the raw code itself:
    write_file(content="function App() { return <div>Hello</div>; }")

CODE RULES:
- You MAY import shadcn components: import { Button } from "@/components/ui/button"
- You MAY import cn utility: import { cn } from "@/lib/utils"
- Do NOT import React or React hooks — they are available globally.
- The function MUST be named `App` and be the default export: export default function App() { ... }
- TypeScript types for all props and state. Never use `any`.
- Style with Tailwind classes and CSS variables. Available variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies.
- Prefer shadcn components over raw HTML elements. Use <Button> not <button>, <Card> not a <div> with card styles, etc.
- Keep it compact — the component must fit within 400px width.

GENERATE ONE FOCUSED COMPONENT (not a full-page layout):
- Button, badge, chip, toggle, switch, input field
- Card (product, profile, stat, feature)
- List item, menu item, navigation item, tab
- Small form (login, search, contact)
- Header section, sidebar section, modal content

DO NOT generate full pages, dashboards, multi-section layouts, or full-screen apps.
```

When `shadcnMode` is OFF, keep the existing prompt (no imports allowed).

### 3.4 Update `COMPONENT_UPDATE_PROMPT_BASE`

Similar dual-mode approach. When shadcn is ON:
- Allow imports in the updated code
- Instruct to preserve existing shadcn imports
- Still output the complete updated function

### 3.5 Add shadcn Toggle UI in ComponentsPanel

Add a toggle button in the ComponentsPanel header (near the dark mode toggle):
- Icon: `Blocks` from lucide (represents component blocks)
- Active state: highlighted when shadcn mode is on
- Tooltip: "Use shadcn/ui components"
- Toggles `settings.shadcnMode`

### 3.6 Update `getComponentNewPrompt()` / `getComponentUpdatePrompt()`

Add `shadcnMode` parameter. When true, prepend the shadcn catalog and use the import-allowing prompt variant.

### 3.7 Doc References for AI Prompt Phase

| Step | Reference |
|------|-----------|
| shadcn component import paths (`@/components/ui/`) | [shadcn Vite installation](https://ui.shadcn.com/docs/installation/vite) — components are installed to `src/components/ui/` with `@/` path alias |
| shadcn `cn()` utility | [shadcn utils docs](https://ui.shadcn.com/docs/installation/vite) — `cn()` combines `clsx` + `tailwind-merge`, installed at `src/lib/utils.ts` |
| shadcn CSS variables for theming | [shadcn theming docs](https://ui.shadcn.com/docs/theming) — `var(--background)`, `var(--primary)`, etc. CSS custom properties |
| shadcn component variants (Button etc.) | [shadcn Button docs](https://ui.shadcn.com/docs/components/button) — variants: default, destructive, outline, secondary, ghost, link |

---

## Phase 4: Theme Integration

**Goal**: Selected theme CSS is written to the generated project and applied in both preview contexts.

### 4.1 Theme Application in Component Preview

When the user selects a theme in ComponentsPanel:
1. Read the theme CSS from the project's theme file
2. Write it to `component-preview/src/styles/preview-theme.css` via `invoke('write_file')`
3. Vite HMR detects the change → preview updates automatically
4. No iframe reload needed

The `preview-theme.css` file is imported by `App.tsx` in the component-preview project, so CSS variable overrides take effect immediately.

### 4.2 Theme Application in Runner

The Runner already has the "Save to Runner" button that writes theme CSS to `generated/`. This continues to work — the Runner has its own independent Vite project in `generated/` with its own theme CSS.

### 4.3 Default Theme in Generated Project

The scaffolded `globals.css` includes the default shadcn neutral theme (same as the main app). When no theme is selected, the preview uses these defaults. When a theme is selected, `preview-theme.css` overrides the `:root` and `.dark` variables.

### 4.4 Theme Generation Prompts

No changes needed — the existing shadcn theme prompt already generates CSS with `:root` + `.dark` blocks using oklch values, which is exactly what `preview-theme.css` expects.

---

## Phase 5: Export Enhancement

**Goal**: Exported components/projects include shadcn dependencies and component files.

### 5.1 Component Export (`export_component`)

When the exported component contains shadcn imports:
1. Scan the component source for `from "@/components/ui/` imports
2. Include those component files in the ZIP under `components/ui/`
3. Include `lib/utils.ts`
4. Add shadcn dependencies to the exported `package.json`

### 5.2 Project Export (`export_project`)

Update the hardcoded `package.json` template to include:
- shadcn dependencies (`class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/*`)
- Path aliases in `tsconfig.json`
- The `src/components/ui/` directory
- The `src/lib/utils.ts` file
- The `src/styles/globals.css` with shadcn CSS variables

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `src/lib/dev-server-manager.ts` | Zustand store managing two Vite dev server instances (preview + runner) |
| `src/lib/scaffold-shadcn.ts` | shadcn component name list, CLI command builders, App.tsx template for scaffolding |
| `component-preview/` | Entire Bun/Vite project directory for component preview (scaffolded at runtime) |
| `component-preview/src/components/Generated.tsx` | The AI-generated component (written at runtime) |
| `component-preview/src/styles/preview-theme.css` | Runtime theme CSS (populated at runtime) |
| `component-preview/scaffold-version.json` | Version marker for scaffold re-detection |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/scaffold.ts` | Add `scaffoldComponentPreview()` for component-preview/ dir; add shadcn CLI commands to `scaffoldGenerated()` for generated/ dir; scaffold versioning for both |
| `src/panels/ComponentsPanel.tsx` | Replace Frame with Vite iframe, add shadcn toggle, use dev-server-manager |
| `src/panels/RunnerPanel.tsx` | Use shared dev-server-manager, keep existing features |
| `src/lib/prompts.ts` | Add shadcn catalog, dual-mode prompt variants, toggle logic |
| `src/lib/preview.tsx` | Deprecate `createPreviewComponent()` (keep `buildPreviewDoc` for Themes) |
| `src/hooks/useSettings.ts` | Add `shadcnMode` to global Settings (or projectSettingsStore — see 3.1) |
| `src/stores/projectSettingsStore.ts` | Add `shadcnMode`, `devServerPort`, `runnerPort` per-project settings |
| Settings modal | Add dev server port inputs (component preview port, runner port), shadcn mode toggle |
| `src-tauri/src/lib.rs` | Update `export_project` / `export_component` for shadcn deps |

### Removed Dependencies (from package.json, eventual)
| Package | Reason |
|---------|--------|
| `react-frame-component` | No longer needed for component preview |
| `@babel/standalone` | May still be needed by Themes panel's `buildPreviewDoc` — evaluate |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Dev server startup time (~3-5s) delays first preview | Start dev server eagerly when project loads; show loading skeleton while starting |
| HMR may lose component state on update | Vite + `@vitejs/plugin-react` provides React Fast Refresh which preserves component state during HMR. Ref: [Vite Features — HMR](https://vite.dev/guide/features#hot-module-replacement) — "First-party HMR integrations are available for React Fast Refresh... without reloading the page or losing application state." Ensure `@vitejs/plugin-react` is included in the scaffolded `vite.config.ts` (it's included by default in `bun create vite --template react-ts`). If a full reload occurs, it's because a non-component file changed (e.g., CSS variable overrides in `preview-theme.css` trigger CSS-only HMR without reload). |
| Scaffold takes longer with shadcn deps (~15-20s total) | Only scaffolds once per project; show progress indicator |
| shadcn component files drift from main app versions | `bunx shadcn@latest add` always fetches latest versions from registry — generated project components are independent of main app versions |
| Runner and ComponentsPanel conflict over same dev server | Separate dev servers: component preview runs from `component-preview/` on `devServerPort`, Runner runs from `generated/` on `runnerPort` |
| Port 5173/5174 already in use | Ports are configurable in Settings. Vite auto-increments if port is busy; the actual URL is captured from terminal output, so the preview always points to the correct URL |
| `postMessage` for dark mode may have timing issues | Add handshake: preview iframe sends "ready" message; parent waits before sending commands |
| Theme CSS write triggers full HMR reload instead of hot update | Ensure `preview-theme.css` is imported as a CSS module; Vite handles CSS HMR natively |
| Export with shadcn components increases ZIP size | shadcn components are small (~2-5KB each); total ~50KB for all 18, acceptable |

---

## Implementation Order

1. **Phase 1** (scaffold) — foundation for everything else
2. **Phase 2** (Vite preview) — unblocks shadcn rendering
3. **Phase 3** (prompts + toggle) — makes AI generate shadcn code
4. **Phase 4** (theme integration) — polish, theme in preview
5. **Phase 5** (export) — final touch, export with shadcn
6. **Phase 6** (verification) — lint, typecheck, cargo check, manual smoke test
7. **Phase 7** (plan implementation verification) — cross-reference every plan item against implemented code
8. **Phase 8** (cleanup) — remove dead code, unused deps, unused imports

Phases 1-3 are the critical path. Phase 4 and 5 can be done in parallel after Phase 2. Phase 6 must complete before Phase 7. Phase 8 is the final step.

---

## Phase 6: Verification

**Goal**: Ensure all code changes pass linting, type checking, and build validation.

### 6.1 TypeScript Check

```bash
bunx tsc --noEmit
```

Run in the main Prototyper project root. Fixes any type errors introduced by:
- `dev-server-manager.ts` — new Zustand store types
- `scaffold.ts` / `scaffold-shadcn.ts` — new function signatures
- `ComponentsPanel.tsx` — removed Frame, added iframe + dev server integration
- `RunnerPanel.tsx` — dev-server-manager integration
- `prompts.ts` — new prompt constants and `shadcnMode` parameter
- `useSettings.ts` — new `shadcnMode` field

### 6.2 ESLint Check

```bash
bun run lint
```

Or check package.json for the lint script. Ensure no new warnings or errors.

### 6.3 Cargo Check (Rust Backend)

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Verifies that any changes to `lib.rs` (export_project, export_component) compile correctly.

### 6.4 Rust Clippy

```bash
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Ensures no Rust lint warnings in the backend changes.

### 6.5 Generated Project Validation

After scaffolding, verify the generated project itself compiles:
```bash
cd {generatedDir} && bunx tsc --noEmit
```

This catches issues like missing path aliases, broken imports, or incorrect shadcn component files.

### 6.6 Manual Smoke Test

- [ ] ComponentsPanel: Select a component → preview renders via component-preview dev server
- [ ] ComponentsPanel: Change theme → preview updates via HMR
- [ ] ComponentsPanel: Toggle dark mode → preview switches via postMessage
- [ ] ComponentsPanel: Toggle shadcn mode → prompt changes
- [ ] ComponentsPanel: Generate a new component with shadcn on → uses Button/Card/etc.
- [ ] ComponentsPanel: Generate a new component with shadcn off → raw Tailwind only
- [ ] RunnerPanel: Click Run → runner dev server starts, preview renders
- [ ] RunnerPanel: File tree, terminal, code editor still work
- [ ] Preview and Runner use separate dev servers and separate directories
- [ ] Export component with shadcn imports → ZIP includes component files
- [ ] Export project → ZIP includes shadcn dependencies and components

---

## Phase 7: Plan Implementation Verification

**Goal**: Systematically verify that every item in this plan was implemented correctly by cross-referencing against the plan.

### 7.1 Phase-by-Phase Checklist

For each phase (1-5), verify:

| Check | Method |
|-------|--------|
| All steps in the phase completed | Re-read the plan section and confirm each numbered step has corresponding code |
| No plan items skipped | Compare plan steps against git diff |
| Implementation matches plan intent | Read the implemented code and verify it achieves what the plan describes |
| No extra unplanned changes introduced | Review git diff for changes not described in this plan |

### 7.2 Specific Verification Items

**Phase 1 — Scaffold:**
- [ ] `scaffoldComponentPreview()` exists in `scaffold.ts`
- [ ] `scaffoldComponentPreview()` calls `bunx --bun shadcn@latest init -t vite --defaults --yes --cwd {componentPreviewDir}` 
- [ ] `scaffoldComponentPreview()` calls `bunx --bun shadcn@latest add {components} --yes --overwrite --cwd {componentPreviewDir}`
- [ ] `component-preview/src/App.tsx` imports Generated component and handles dark mode via postMessage
- [ ] `component-preview/src/styles/preview-theme.css` exists (empty) after scaffold
- [ ] `component-preview/src/components/Generated.tsx` placeholder exists after scaffold
- [ ] `component-preview/src/components/ui/` contains all 18 shadcn primitives after scaffold
- [ ] `component-preview/src/lib/utils.ts` with `cn()` exists after scaffold
- [ ] `component-preview/tsconfig.json` has `@/*` path alias after scaffold
- [ ] `component-preview/scaffold-version.json` has `{ version: 2 }`
- [ ] `scaffoldGenerated()` also calls shadcn init + add for the `generated/` directory
- [ ] `generated/scaffold-version.json` has `{ version: 2 }`
- [ ] `hasViteScaffold()` checks scaffold version for both directories

**Phase 2 — Vite Preview:**
- [ ] `dev-server-manager.ts` exists and exports Zustand store with `startPreview()` and `startRunner()`
- [ ] `dev-server-manager.ts` accepts configurable port parameter for each server
- [ ] `ComponentsPanel.tsx` no longer imports `react-frame-component`
- [ ] `ComponentsPanel.tsx` no longer calls `createPreviewComponent()`
- [ ] `ComponentsPanel.tsx` renders `<iframe src={previewUrl}>` from component-preview dev server
- [ ] `ComponentsPanel.tsx` sends `postMessage` for dark mode toggle
- [ ] `ComponentsPanel.tsx` writes theme CSS to `component-preview/src/styles/preview-theme.css`
- [ ] `ComponentsPanel.tsx` writes component code to `component-preview/src/components/Generated.tsx`
- [ ] `ComponentsPanel.tsx` passes `settings.devServerPort` to `devServerManager.startPreview()`
- [ ] `RunnerPanel.tsx` uses `devServerManager.startRunner()` instead of own `bunDev()`
- [ ] `RunnerPanel.tsx` passes `settings.runnerPort` to `devServerManager.startRunner()`
- [ ] Preview and Runner use separate dev servers on separate ports

**Phase 3 — AI Prompts:**
- [ ] `projectSettingsStore.ts` has `shadcnMode: boolean` field
- [ ] `projectSettingsStore.ts` has `devServerPort: number` field (default 5173)
- [ ] `projectSettingsStore.ts` has `runnerPort: number` field (default 5174)
- [ ] Settings modal has dev server port inputs
- [ ] `prompts.ts` has `SHADCN_COMPONENT_CATALOG` constant
- [ ] `prompts.ts` has shadcn-mode `COMPONENT_NEW_PROMPT` variant (allows imports)
- [ ] `prompts.ts` has shadcn-mode `COMPONENT_UPDATE_PROMPT` variant
- [ ] `getComponentNewPrompt()` accepts `shadcnMode` parameter
- [ ] `getComponentUpdatePrompt()` accepts `shadcnMode` parameter
- [ ] `ComponentsPanel.tsx` has shadcn toggle button in header

**Phase 4 — Theme Integration:**
- [ ] Theme selection writes CSS to `component-preview/src/styles/preview-theme.css`
- [ ] Theme CSS changes trigger HMR (no full reload)
- [ ] Default theme (no selection) uses scaffolded `globals.css` variables
- [ ] Runner theme "Save to Runner" still works independently

**Phase 5 — Export:**
- [ ] `export_component` scans for `@/components/ui/` imports
- [ ] `export_component` includes referenced shadcn files in ZIP
- [ ] `export_project` includes shadcn dependencies in package.json
- [ ] `export_project` includes `src/components/ui/`, `src/lib/utils.ts`, `globals.css`

### 7.3 Regression Check

- [ ] ThemesPanel preview still works (uses `buildPreviewDoc` — not changed)
- [ ] ScreensPanel still works (not changed by this plan)
- [ ] WorkflowsView still works (not changed)
- [ ] Library panel still works (not changed)
- [ ] All keyboard shortcuts still work (Ctrl+S, Ctrl+Z)
- [ ] Settings persistence works (new `shadcnMode` field saved/loaded)
- [ ] No `any` types introduced
- [ ] No eslint ignore comments added

---

## Phase 8: Cleanup

**Goal**: Remove dead code, unused imports, and unnecessary dependencies introduced or revealed by the refactoring.

### 8.1 Remove Unused Preview Code from `preview.tsx`

After ComponentsPanel no longer uses in-process preview:
- Remove `transformTsx()` — only used by `createPreviewComponent()`
- Remove `extractComponent()` — only used by `createPreviewComponent()`
- Remove `createPreviewComponent()` — no longer called
- Remove `getParentCss()` — only used by Frame-based preview
- Remove `getIconFontCss()` / `useIconFontCss()` — only used by Frame-based preview
- **Keep** `buildPreviewDoc()` — still used by ThemesPanel
- **Keep** `extractCode()` — still used by AI response processing
- Remove `window.parent.__IconLib` and `window.parent.__React` setup code if no longer referenced

### 8.2 Remove Unused Dependencies

After verifying nothing else uses them:
- Remove `react-frame-component` from `package.json`
- Evaluate `@babel/standalone` — if `buildPreviewDoc()` in ThemesPanel still needs it, keep it; otherwise remove
- Run `bun install` to update lockfile after removals

### 8.3 Remove Dead Code from ComponentsPanel

- Remove imports of `Frame`, `createPreviewComponent`, `getParentCss`, `useIconFontCss`
- Remove `PreviewErrorBoundary` if no longer needed (Vite dev server handles errors natively)
- Remove `window.parent.__IconLib` population code if no longer needed
- Remove any `useMemo` for `Preview` component creation
- Remove `parentCss` and `iconFontCss` state variables

### 8.4 Remove Dead Code from RunnerPanel

- Remove direct `bunDev()` call (replaced by `devServerManager.startRunner()`)
- Remove local dev server URL state (now in Zustand store)
- Remove local URL detection logic from terminal output parsing (now in `dev-server-manager.ts`)

### 8.5 Update `applyCode` in ComponentsPanel

- Currently writes to `generated/src/components/Generated.tsx` — must be updated to write to `component-preview/src/components/Generated.tsx` instead
- Also update the save-to-component-file path to write to the project's component storage (unchanged) and additionally to `component-preview/`

### 8.5 General Cleanup

- Search for any `TODO`, `FIXME`, or `HACK` comments introduced during implementation
- Verify no unused imports remain in any modified files
- Verify no unused variables remain (run `bunx tsc --noEmit` to catch)
- Search for and remove any dead code — functions, variables, types, or imports that are defined but never referenced anywhere in the codebase
- Check for orphaned code paths that are no longer reachable due to the refactoring (e.g., code that was only called from `createPreviewComponent()`, branches that depended on Frame-based rendering)
- Run final lint check: `bun run lint`
- Run final type check: `bunx tsc --noEmit`
- Run final cargo check: `cargo check --manifest-path src-tauri/Cargo.toml`

### 8.6 Final Verification After Cleanup

- [ ] `bunx tsc --noEmit` passes with zero errors
- [ ] `bun run lint` passes with zero warnings
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes
- [ ] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` passes
- [ ] App launches and all panels work correctly
- [ ] No console errors in browser devtools
- [ ] No dead code or unused imports in any modified file
