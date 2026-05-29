# Plan: Enhance Prototyper for Runnable, Exportable Apps

_Plan status: READY FOR REVIEW_

---

## Context

The Prototyper generates React UI with shadcn/ui + Tailwind but can't produce truly runnable apps yet because:

1. **API integration is siloed** — the API panel is a standalone HTTP client; definitions never flow into generation prompts
2. **CORS blocks real API calls** — generated apps run in a browser iframe; fetch() to external APIs fails without a proxy
3. **No ENV management** — no way to inject API keys as `VITE_*` env vars into the generated project
4. **Generated app has no router** — `generated/` can't navigate between screens; only `screen-preview/` has React Router
5. **Design quality is generic** — prompts lack design-system context; UI looks like a default shadcn prototype
6. **Export is incomplete** — zip has no router, no services, no .env.example, won't `bun dev` out of the box

**User-confirmed decisions:**
- CORS strategy: **Vite proxy** (patches `vite.config.ts` with per-API proxy entries)
- Generated code pattern: **TanStack Query** (`useQuery`, `useMutation`)
- Router: **auto-wire from Flows panel** (navigation.json → `src/router.tsx`)
- Design goal: **distinctive theming via opendesigner.io DESIGN.md system** — design brief selected from dropdown at generation time (not auto-injected), with palette + description preview per item
- APIs to pre-configure: **JSONPlaceholder, OpenWeatherMap, GitHub REST**
- API panel upgrades: Key Vault, Generate Service, API selection at generation time, CodeMirror response viewer
- **Components are selectable during screen generation** — user picks which existing components to reference/insert into the new screen
- Export: **runnable zip** (`bun dev` works out of the box)

---

## Architecture After This Plan

```
API Panel (Key Vault + Inject toggle)
    │
    ├─ Keys → generated/.env.local (VITE_KEY=...)
    ├─ Hosts → generated/vite.config.ts (proxy /api/* → host)
    └─ API context → injected into generation prompts
            │
            ▼
Screen / Component Generation
  (system prompt now includes: design tokens + DESIGN.md brief + API endpoints + TanStack types)
            │
            ▼
generated/
  ├─ src/services/{name}.ts    ← AI-generated TanStack Query hooks
  ├─ src/router.tsx            ← auto-generated from Flows/navigation.json
  ├─ src/main.tsx              ← QueryClientProvider + RouterProvider
  └─ vite.config.ts            ← proxy entries per API host
```

---

## Full App Generation Flow (User Journey)

This section describes the end-to-end experience of generating a working weather app prototype from scratch.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FULL APP GENERATION FLOW                                 │
│                    (e.g. Weather Dashboard App)                             │
└─────────────────────────────────────────────────────────────────────────────┘

  USER ACTION                    SYSTEM RESPONSE
  ──────────────────────────     ──────────────────────────────────────────────

  1. NEW PROJECT
  ─────────────────────────────────────────────────────────────────────────────
  Click "New Project"            Creates project directory structure
  Name it "Weather App"          Defers scaffold until Runner is opened


  2. THEMES PANEL  ──────────────────────────────────────────────────────────
  Open Themes → "Design Brief"   Opens CodeMirror text editor for DESIGN.md
  Pick "Glass Morphism" template  Loads brief: dark bg, blur, vibrant gradients
  [Optional] Prompt the AI        Generates/refines full CSS theme to match brief
  Save theme                     Writes theme.css + design-brief.md to project
                                 Brief now injected into ALL future generation prompts


  3. APIs PANEL  ────────────────────────────────────────────────────────────
  Click "Add from Template"      Opens picker: JSONPlaceholder / OpenWeatherMap / GitHub
  Select "OpenWeatherMap"        Inserts pre-built SavedApi with proxy config
  Go to "Keys" tab               Shows Key Vault
  Add: OPENWEATHERMAP_KEY=abc123 Stores in keys.json
  Click "Sync to Project" (auto) Writes generated/.env.local (VITE_OPENWEATHERMAP_KEY=abc123)
                                 Writes generated/proxy.config.json
                                 Patches generated/vite.config.ts with proxy entry
  Toggle "Inject" on API         Marks API as active context for next generation


  4. SCREENS PANEL  ─────────────────────────────────────────────────────────
  Generation toolbar appears      Three dropdowns above the chat input:
  above chat input:
    ┌─ Design Brief ──────────┐   Dropdown shows saved briefs + built-in templates,
    │ ◉ Glass Morphism    ▼  │   each with a 5-color palette swatch and one-line
    │   Minimal / Clean      │   description. User picks one (or "None").
    │   Neo-Brutalism        │
    │   Neon / HUD           │
    └────────────────────────┘
    ┌─ APIs ──────────────────┐   Multi-select list of all project APIs.
    │ ☑ OpenWeatherMap    ▼  │   Checked APIs injected as context in the prompt.
    │ ☐ GitHub REST          │
    │ ☐ JSONPlaceholder      │
    └────────────────────────┘
    ┌─ Components ────────────┐   Multi-select of saved components. Checked ones
    │ ☑ WeatherCard       ▼  │   included in prompt as "available components to
    │ ☑ SearchInput          │   reuse" — AI uses them in the generated screen.
    │ ☐ NavBar               │
    └────────────────────────┘

  Type: "Weather dashboard with  System prompt now includes:
    city search, temperature,      • Glass Morphism design brief (from dropdown)
    hourly forecast, conditions"   • OpenWeatherMap endpoints + types (selected)
                                   • WeatherCard + SearchInput component code (selected)
                                   • Proxy path /api/weather
                                   • TanStack Query instructions
                                   • Design tokens from saved theme
  AI streams response             Generates WeatherDashboard.tsx with:
                                   • useQuery() from @tanstack/react-query
                                   • import { useWeather } from '@/services/weather'
                                   • Loading skeleton, error state, real data render
  Preview updates live            Shows component preview iframe with mock → real data
  Type: "Add a search page        Generates SearchPage.tsx
    with autocomplete"


  5. APIs PANEL → GENERATE SERVICE  ─────────────────────────────────────────
  Open OpenWeatherMap entry       Shows endpoint + inferred response schema
  Click "Generate Service"        Modal opens with service name pre-filled "weather"
  Confirm                         AI generates src/services/weather.ts:
                                   • TypeScript interfaces (WeatherData, ForecastItem, ...)
                                   • useCurrentWeather(city: string) hook
                                   • useWeatherForecast(city: string, days: number) hook
                                   • Proxy base URL /api/weather
                                   • VITE_OPENWEATHERMAP_KEY usage
                                  File written to generated/src/services/weather.ts
                                  Shown in CodeMirror preview


  6. FLOWS PANEL  ───────────────────────────────────────────────────────────
  Open Flows → canvas appears     Shows screen nodes: WeatherDashboard, SearchPage
  Connect SearchPage → Dashboard  Edge created: navigation link
  Right-click Dashboard → "Set    Marks as entry point in navigation.json
    as entry screen"
  Save                            Writes navigation.json
                                  AUTO-GENERATES generated/src/router.tsx:
                                    <Route path="/" → WeatherDashboard />
                                    <Route path="/search" → SearchPage />
                                    <Navigate default to="/" />


  7. RUNNER PANEL  ──────────────────────────────────────────────────────────
  Click "Run"                     Checks scaffold validity
  [First time] "Create scaffold"  Runs: shadcn init + shadcn add --all
                                  Installs: @tanstack/react-query, react-router-dom
                                  Patches: main.tsx with QueryClientProvider + BrowserRouter
                                  Copies: all screens, services, router, theme
  Dev server starts               Vite serves on port 5174 with proxy active
  Preview iframe loads            Shows Glass Morphism weather dashboard
  Type city "New York" + search   Real fetch to /api/weather → OpenWeatherMap → live data
  Click "Search" link             Router navigates to /search — full SPA routing works
  Edit code in file tree          Hot reload updates preview in real time


  8. EXPORT  ─────────────────────────────────────────────────────────────────
  Click Export (download icon)    Opens Export modal
  Select options                  Format: Vite SPA | Include: APIs, theme, components
  Confirm                         Rust backend zips:
                                   • All source files
                                   • src/services/weather.ts
                                   • src/router.tsx
                                   • vite.config.ts (with proxy)
                                   • .env.example (keys blanked with comments)
                                   • README.md (setup instructions)
  Download weather-app.zip        Unzip → cp .env.example .env.local → fill key → bun dev
                                  ✓ Fully runnable in any machine with Bun installed
```

### Interaction Summary Diagram

```
┌──────────┐    Design    ┌──────────┐    API Keys   ┌──────────┐
│  THEMES  │ ──────────► │   APIs   │ ────────────► │ SCREENS  │
│          │   Brief      │          │  Inject ctx   │          │
│ Design   │   injected   │ Key Vault│  into prompt  │ Generate │
│ Brief    │   into all   │ Proxy    │               │ w/ Query │
│ Template │   prompts    │ Templates│               │ & types  │
└──────────┘              └──────────┘               └──────────┘
                               │                          │
                         Generate Service            Screen saved
                               │                          │
                               ▼                          ▼
                    ┌──────────────────┐        ┌──────────────────┐
                    │ src/services/    │        │   FLOWS PANEL    │
                    │ weather.ts       │        │                  │
                    │ (TanStack hooks  │        │  Link screens    │
                    │  + TS types)     │        │  Set entry point │
                    └──────────────────┘        │  → router.tsx    │
                               │                └──────────────────┘
                               └──────────┬──────────────┘
                                          ▼
                               ┌──────────────────┐
                               │  RUNNER PANEL    │
                               │                  │
                               │  Scaffold once   │
                               │  Dev server      │
                               │  Live preview    │
                               │  File editor     │
                               │  Terminal        │
                               └──────────────────┘
                                          │
                                       Export
                                          │
                                          ▼
                               ┌──────────────────┐
                               │  weather-app.zip  │
                               │  .env.example     │
                               │  vite.config.ts   │
                               │  src/router.tsx   │
                               │  src/services/    │
                               │  → bun dev ✓     │
                               └──────────────────┘
```

---

## Implementation Plan

### Phase 1 — Scaffold Upgrades (foundation for everything else)

**1.1 — TanStack Query in generated/ scaffold**
- File: `src/lib/scaffold.ts` (the `scaffoldGenerated()` function)
- After `shadcn init` + `shadcn add --all`, run:
  ```
  bun add @tanstack/react-query
  ```
- Patch `src/main.tsx` (written by scaffold) to wrap `<App>` with `<QueryClientProvider client={queryClient}>`
- Add `const queryClient = new QueryClient()` import

**1.2 — React Router in generated/ scaffold**
- Also install `react-router-dom@^7` in generated/ during scaffold
- Patch `src/main.tsx` to wrap with `<BrowserRouter>`
- Create `src/router.tsx` stub: empty routes array, auto-populated by Flows sync (Phase 3)
- Update `src/App.tsx` in generated/ to use `<Routes>` from router.tsx

**1.3 — Vite proxy plumbing**
- Scaffold writes a `vite.config.ts` that reads from a local `proxy.config.json` file (if present)
- `proxy.config.json` format: `{ "/api/weather": "https://api.openweathermap.org", ... }`
- This file is written by the API Key Vault sync (Phase 2)

---

### Phase 2 — API Panel Overhaul

**File: `src/panels/APIsPanel.tsx`**

**2.1 — Key Vault tab**
- New tab "Keys" alongside the existing request/response tabs
- Two sections:
  - **API Keys** — project-level key-value pairs (name, value, description)
  - **Proxy Mappings** — auto-derived from API collection: `/api/{slug}` → host URL
- Stored in `projects/{project}/apis/keys.json`
- "Sync to Project" button (also auto-syncs on change):
  - Writes `generated/.env.local` with `VITE_{KEY}=...` per key
  - Writes `generated/proxy.config.json` with proxy mappings

**2.2 — API selection at generation time (replaces global toggle)**
- Remove the global "Inject into generation" toggle from the API list sidebar
- Instead: a multi-select API dropdown in the generation toolbar (above chat input in Screens + Components panels)
- Dropdown shows all project APIs with method badge and URL; user picks which to include per generation
- Selected APIs stored as ephemeral UI state (not persisted); default = all APIs checked
- API defs (name, method, URL, schema summary) formatted into the system prompt for checked APIs only

**2.3 — Generate Service button**
- "Generate Service" button in API detail pane header
- Opens a modal: shows API name, endpoint, inferred response type
- Triggers AI generation (using existing `generateCompletionStream`) with a targeted prompt:
  - Generate `src/services/{name}.ts` with:
    - Typed TypeScript interfaces from response schema
    - `useQuery` hook using `VITE_*` env var for auth
    - Proxy path (`/api/{slug}/...`) as base URL
  - Writes directly to `generated/src/services/{name}.ts` via `write_file` tool
- Uses CodeMirror to show the generated file after creation

**2.4 — CodeMirror response viewer**
- Replace the current `<pre>` response body display with a CodeMirror instance (already used in RunnerPanel and ComponentsPanel)
- Auto-detect: JSON → json mode, HTML → html, plain → text
- Add "Infer Types" button: sends response body to AI → returns TypeScript interface, shown in a side panel

**2.5 — Pre-configured API templates**
- "Add from Template" button in the API collection sidebar
- Opens a picker with 3 pre-built templates:
  - **JSONPlaceholder** — base URL `https://jsonplaceholder.typicode.com`, endpoints: /posts, /users, /todos
  - **OpenWeatherMap** — base URL `https://api.openweathermap.org/data/2.5`, requires `OPENWEATHERMAP_KEY`, proxy `/api/weather` → host
  - **GitHub REST** — base URL `https://api.github.com`, endpoints: /repos, /users, /search/repositories
- Inserts pre-built `SavedApi` entries into the collection

---

### Phase 3 — Flows → Router Auto-wiring

**3.1 — navigation.json → router.tsx sync**
- File: `src/panels/FlowsPanel.tsx` (or a new `src/lib/router-sync.ts`)
- When Flows panel saves `navigation.json`, also call a new function `syncNavigationToRouter(projectId, navigation)`
- This reads all screen files from `projects/{project}/screens/` and matches node IDs to file paths
- Generates `generated/src/router.tsx`:
  ```typescript
  // Auto-generated from Flows panel. Edit in Flows panel.
  import { Routes, Route, Navigate } from 'react-router-dom';
  import DashboardScreen from './screens/screen_abc123';
  // ...
  export function AppRouter() {
    return (
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" />} />
        <Route path="/dashboard" element={<DashboardScreen />} />
      </Routes>
    );
  }
  ```
- `generated/src/App.tsx` imports `<AppRouter />` from router.tsx
- Runner panel shows a "Router synced" indicator when navigation.json and router.tsx are in sync

**3.2 — Screen copy on generation**
- When a screen is saved (in ScreensPanel), it already copies to `generated/src/screens/{id}.tsx`
- Ensure imports in those screen files are corrected: `@/components/ui/*` paths stay valid in generated/ context
- Screens that use `useNavigate()` automatically work since generated/ now has react-router-dom

---

### Phase 4 — Generation Prompt Upgrades

**4.1 — API context injection section**
- File: `src/lib/prompts/shared.ts`
- Add a new `buildApiContextSection(apis: SavedApi[])` function (similar to `buildDesignTokensSection`)
- Formats injected APIs as:
  ```
  AVAILABLE APIS — use these for data fetching with TanStack Query:
  
  API: OpenWeatherMap
  Base path: /api/weather (proxied, no CORS issues)
  Auth: VITE_OPENWEATHERMAP_KEY env var
  Key endpoints:
    GET /api/weather/weather?q={city}&appid=${import.meta.env.VITE_OPENWEATHERMAP_KEY}
    → { weather: [{description}], main: {temp, humidity}, ... }
  
  Use useQuery() from @tanstack/react-query for all data fetching.
  Import: import { useQuery } from '@tanstack/react-query'
  ```
- This section appended to screen/component system prompts when `injectIntoGeneration` APIs exist

**4.2 — DESIGN.md context injection (opendesigner.io style)**
- File: `src/lib/prompts/shared.ts` — add `buildDesignBriefSection(brief: string)`
- File: `src/panels/ThemesPanel.tsx` — add "Design Brief" tab to create/manage briefs
- Design Brief tab: CodeMirror text editor + save as named brief
- Each saved brief stored as `projects/{project}/themes/briefs/{name}.md` with a metadata header:
  ```
  # Glass Morphism
  description: Frosted glass, blur effects, dark bg, vibrant gradients
  palette: #0f0f1a #ffffff30 #a78bfa #60a5fa #f0abfc
  ```
- Palette + description render as a swatch+text preview in the generation toolbar dropdown
- Brief NOT auto-injected — user selects per-generation from the "Design Brief" dropdown
- If none selected, falls back to design tokens only (existing behavior)
- Ship 4 built-in briefs (read-only, can be duplicated):
  1. **Minimal / Clean** — lots of whitespace, Inter font, neutral palette, subtle borders
  2. **Neo-Brutalism** — thick black borders, flat colors, strong contrast, Mono font
  3. **Glass Morphism** — frosted glass, blur, dark backgrounds, vibrant gradients
  4. **Neon / HUD** — dark theme, green/cyan accent, monospace font, data-dense layouts
- User can also paste any DESIGN.md from opendesigner.io/design-systems and save as a new brief

**4.3 — Component insertion into screen generation**
- File: `src/panels/ScreensPanel.tsx` — add "Components" multi-select dropdown to generation toolbar
- Dropdown lists all project components (from `projects/{project}/components/`) with name + type badge
- When one or more components are selected, their source code is read and appended to the system prompt:
  ```
  AVAILABLE COMPONENTS — reuse these existing components in the screen you generate:

  Component: WeatherCard (src/components/weather-card/component.tsx)
  ---
  [component source code]
  ---
  Import as: import WeatherCard from '@/components/weather-card/component'
  ```
- AI is instructed to prefer these components over generating new ones from scratch
- Selection is per-generation (ephemeral), default = none selected

**4.4 — Improve screen generation prompt quality**
- File: `src/lib/prompts/screens.ts`
- Add instruction to use TanStack Query when API context is present
- Add instruction to write loading + error states for every async operation
- Add instruction to use proper TypeScript types (no `any`)
- Add instruction referencing the service file pattern: "import hooks from `@/services/{name}`"

---

### Phase 5 — Export Enhancement

**File: `src-tauri/src/commands/export.rs`**

**5.1 — Include router and services in export**
- Copy `generated/src/router.tsx` into exported zip
- Copy `generated/src/services/` directory
- Patch exported `src/main.tsx` to include QueryClientProvider + BrowserRouter

**5.2 — .env.example generation**
- Read `generated/.env.local` keys → write `.env.example` with blank values + comments
- Example:
  ```
  # OpenWeatherMap API Key (get free key at openweathermap.org)
  VITE_OPENWEATHERMAP_KEY=
  
  # GitHub Personal Access Token (optional, for authenticated requests)
  VITE_GITHUB_TOKEN=
  ```

**5.3 — Vite proxy in export**
- Include `proxy.config.json` in export
- Update README instruction: "Copy .env.example to .env.local, fill in keys, then run bun dev"

---

## Files Modified (complete list)

| File | What changes |
|------|-------------|
| `src/lib/scaffold.ts` | Add TanStack Query + react-router-dom install; patch main.tsx; write router.tsx stub; write vite.config.ts with proxy.config.json support |
| `src/panels/APIsPanel.tsx` | Key Vault tab; Inject toggle; Generate Service button; CodeMirror response viewer; pre-configured templates; sync to .env.local + proxy.config.json |
| `src/lib/prompts/shared.ts` | `buildApiContextSection()`, `buildDesignBriefSection()`, `buildComponentsSection()` |
| `src/lib/prompts/screens.ts` | TanStack Query instructions, loading/error states, service file imports |
| `src/lib/prompts/components.ts` | Lightweight API context for data-driven components |
| `src/panels/FlowsPanel.tsx` | `syncNavigationToRouter()` — writes router.tsx on navigation save |
| `src/panels/ThemesPanel.tsx` | Add "Design Brief" tab: CodeMirror editor, palette metadata, 4 built-in briefs |
| `src/panels/ScreensPanel.tsx` | Generation toolbar: Design Brief dropdown, APIs multi-select, Components multi-select |
| `src/panels/ComponentsPanel.tsx` | Generation toolbar: Design Brief dropdown, APIs multi-select |
| `src/panels/RunnerPanel.tsx` | Show env/proxy status; "Router synced" indicator |
| `src-tauri/src/commands/export.rs` | Include router.tsx, services/, .env.example, proxy.config.json |

---

## Pre-configured API Templates (hardcoded)

### OpenWeatherMap
```json
{
  "name": "OpenWeatherMap",
  "method": "GET",
  "url": "https://api.openweathermap.org/data/2.5/weather?q=London&appid={{OPENWEATHERMAP_KEY}}",
  "authType": "none",
  "proxy": { "path": "/api/weather", "target": "https://api.openweathermap.org" }
}
```

### GitHub REST
```json
{ "name": "GitHub — Search Repos", "method": "GET", "url": "https://api.github.com/search/repositories?q=react", "proxy": { "path": "/api/github", "target": "https://api.github.com" } }
```

### JSONPlaceholder
```json
{ "name": "JSONPlaceholder — Posts", "method": "GET", "url": "https://jsonplaceholder.typicode.com/posts", "proxy": { "path": "/api/fake", "target": "https://jsonplaceholder.typicode.com" } }
```

---

## Verification (Happy Path: Weather App)

1. New project → Themes panel → "Design Brief" → select "Glass Morphism" template
2. APIs panel → "Add from Template" → add OpenWeatherMap → Keys tab → add `OPENWEATHERMAP_KEY=abc123` → "Sync to Project"
3. Toggle "Inject" on the OpenWeatherMap API
4. Screens panel → prompt: "Build a weather dashboard for a city search" → generate
5. Generated screen uses `useWeather()` from `@/services/weather` with `useQuery`, shows loading + error states
6. Runner → scaffold check → Run → dev server starts → preview shows real weather data from proxy
7. Flows panel → add Dashboard screen as entry → router.tsx auto-generated
8. Runner preview: can navigate between screens
9. Export → zip → unzip → `cp .env.example .env.local` → edit key → `bun dev` → works in browser

---

## Open Questions (lower priority, decide during implementation)

- Should "Sync to Project" be automatic on key change or require a button press? (recommendation: auto, debounced 1s)
- Should the router sync happen automatically when Flows saves, or require a "Build Router" button?
- Should CodeMirror in APIsPanel be read-only for responses, or editable (for request body already in editor)?
