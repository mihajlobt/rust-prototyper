# Navigation Simplification Plan

## The Problem

The same user intent — "clicking this button should go to that screen" — currently requires
coordinating **4 data structures** (NavPort, NavLink, Hotspot, NavScreen) across **3 UI
surfaces** (Flows graph, Screens → Ports tab, Screens → Select Element flow). The result:

- **Cognitive overhead**: Users must understand ports, hotspots, links, and how they relate
- **Fragmented workflow**: Creating a link from Flows doesn't create a hotspot; creating one
  from Screens requires 4+ clicks through a modal
- **Dead-end state**: "Just a port (no link yet)" creates orphaned ports users forget about
- **Redundant data**: Ports and hotspots track the same concept (a clickable element) through
  different abstractions

## Design Principles (from DESIGN.md)

1. **Density without clutter** — merge related concepts, don't add panels
2. **State by color and motion** — links show as edges in the graph AND highlights on preview
3. **The app recedes; content advances** — the navigation system should be invisible until needed

## Proposed Architecture

### Core Idea: Hotspots ARE the navigation system

Instead of Port → Hotspot → Link → Router, the model becomes:

```
User clicks element → Hotspot created → Link auto-derived → Router auto-generated
```

**Hotspot** is the only user-facing concept. It has:
- `selector` (which element)
- `targetScreenId` (where it goes)
- `label` (human-readable name, auto-derived from element)

Ports and Links become **internal derivation** — computed when syncing the router, not stored
as primary entities.

### Simplified Data Model

```typescript
// BEFORE (4 concepts)
interface NavPort { id, name, direction, type, schema }
interface NavLink { id, from, fromPort, to, toPort, type }
interface Hotspot { id, screenId, selector, rect, targetScreenId, portId }
interface NavScreen { id, path, title, ports, layout, x, y }

// AFTER (2 concepts)
interface Hotspot {
  id: string
  screenId: string
  selector: string           // CSS selector into live DOM
  rect: { x, y, w, h }      // Bounding box
  targetScreenId: string     // Where clicking this element navigates
  label: string              // "Submit Button" — auto-derived from selector/element
}

interface NavScreen {
  id: string
  path: string
  title: string
  // Ports removed — derived from hotspots
  layout?: string
  x?: number
  y?: number
}

// Links are computed, not stored:
// For each hotspot with a targetScreenId, there is an implicit link.
// syncGeneratedRouter() derives port IDs internally.
```

### Navigation storage changes

`navigation.json` simplifies:
```json
{
  "defaultScreen": "home",
  "screens": [
    { "id": "home", "path": "/", "title": "Home", "x": 100, "y": 100 }
  ],
  "hotspots": [
    { "id": "h1", "screenId": "home", "selector": "#btn-submit", "targetScreenId": "checkout", "label": "Submit" }
  ]
}
// No more "links" or "ports" arrays
```

Backward compatibility: `loadNavigation()` migrates old format automatically — reads existing
ports/links, converts hotspot-linked ports to simplified hotspots, discards orphan ports.

---

## UI Changes

### 1. Replace Flows Panel with Flows Overlay in Screens Panel

**Current**: Flows is a full separate panel in the sidebar (8th view).

**Proposed**: Remove Flows as a standalone panel. Instead, add a **mini graph** to the
Screens panel toolbar — a small拓扑 visualization that shows how the current screen connects
to others.

```
┌─ Screens Panel ──────────────────────────────────────────────────┐
│ [home]  ↗ 3 links  │  ● Checkout  ● Profile  ● Settings  │ ⚙ │
│                                                                 │
│ ┌─ Preview ──────────────┐  ┌─ Links ──────────────────────┐   │
│ │                         │  │                              │   │
│ │   [Live iframe]         │  │  🔗 Submit Button → Checkout │   │
│ │                         │  │  🔗 Profile Pic → Profile    │   │
│ │   Hotspot highlights    │  │  🔗 Settings Gear → Settings │   │
│ │                         │  │                              │   │
│ │                         │  │  [+ Add Link]                │   │
│ └─────────────────────────┘  └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

The "Go to Flows" button in FlowsPanel becomes a **"View all screens"** button that expands
the mini graph into a full-width overlay (still within Screens panel, not a separate view).

**Mini graph**: Shows the current screen at center, connected screens as neighbor nodes. Uses
a simple force-directed or grid layout — not full React Flow. Just enough to see the topology.

**Full graph overlay**: Toggled via button. Shows the full React Flow graph (same as current
FlowsView). Clicking a node switches to that screen.

### 2. Replace Ports Tab with Links Tab

**Current**: Ports tab shows input/output ports with direction toggles, type switches, and
manual add/rename/delete.

**Proposed**: Links tab shows a flat list of clickable elements on this screen:

```
┌─ Links ──────────────────────────────────────┐
│                                              │
│  Submit Button          →  Checkout     [×]  │
│  Profile Avatar         →  Profile      [×]  │
│  "Learn More" link      →  (unlinked)   [×]  │
│                                              │
│  [+ Add Link]                                │
└──────────────────────────────────────────────┘
```

Each row: **element label → target screen → delete**. No ports, no schemas, no direction
toggles. The "Add Link" button enters select-element mode on the iframe.

**Unlinked elements**: If user picks an element but doesn't choose a target, it shows as
"(unlinked)" with a dropdown to assign a target later.

### 3. Simplified "Add Link" Flow

**Current flow** (4+ clicks):
1. Click "Select Element" button
2. Click element in preview
3. Modal appears with screen list
4. Click target screen
5. (Optional) Confirm

**New flow** (2 clicks):
1. Click "+ Add Link" (or click the "+" in the toolbar)
2. Click element in preview
3. **Inline dropdown** appears at the element's position with screen options
4. Click target — done

No modal. No port creation. No separate confirmation. The dropdown appears exactly where the
user clicked, maintaining spatial context.

### 4. Hotspot Visual Improvements

**Current**: Hotspot highlights only visible when Ports tab is active. Plain cyan borders.

**Proposed**: 
- Hotspot highlights always visible in preview (thin `1px` borders, `--primary` color)
- Each hotspot shows a **small arrow badge** indicating direction (→ Checkout)
- Hovering a hotspot highlights its row in the Links tab (and vice versa)
- Hotspot labels use 9px mono text, matching DESIGN.md micro-label style

---

## Implementation Plan

### Phase 1: Data Model Migration (navigation.ts)

**Files**: `src/lib/navigation.ts`

1. **Add `label` field to Hotspot type**
   ```typescript
   interface Hotspot {
     // ...existing fields...
     label: string  // auto-derived from selector: "#btn-submit" → "Submit"
   }
   ```

2. **Add migration logic in `loadNavigation()`**
   - If old format has `ports` and `links`, migrate:
     - For each hotspot with a portId, find the matching link
     - Convert to simplified hotspot (targetScreenId from link)
     - Compute label from port name or selector
   - Save migrated format

3. **Deprecate but keep `addNavLink` / `removeNavLink`** as internal functions
   - `addNavLink` now just creates a hotspot with a target
   - `removeNavLink` clears the target from a hotspot

4. **Simplify `createHotspotWithLink`**
   - Remove port creation logic
   - Just create a hotspot with targetScreenId

5. **Update `syncGeneratedRouter`**
   - Derive ports internally from hotspots:
     - Each hotspot with a targetScreenId becomes a `{screenId}:hotspot-{n}` port
     - Links are derived: `{screenId}:{hotspotPort} -> {target}:default-in`
   - No changes to generated router output — just the derivation path

6. **Add `labelFromSelector(selector: string): string` helper**
   - `"#btn-submit"` → `"Submit"`
   - `".nav-link > span"` → `"Nav Link"`
   - `"button[type=submit]"` → `"Submit Button"`

### Phase 2: Links Tab (replacing PortsTab)

**Files**: `src/panels/flows/PortsEditor.tsx` → rename to `LinkEditor.tsx`

1. **Rewrite as `LinkEditor`**
   - Input: `hotspots: Hotspot[]`, `projectDir: string`, `screenId: string`
   - Output: list of hotspot rows with label, target dropdown, delete button
   - "+ Add Link" button triggers select-element mode

2. **Add inline target selector**
   - Each row has a small dropdown showing available screens
   - Changing target immediately updates the hotspot + syncs router

3. **Wire up select-element flow**
   - Reuse existing iframe postMessage protocol (`enable-link-mode` / `element-selected`)
   - On element selection, create hotspot with empty target
   - Auto-scroll to the new row and focus the target dropdown

4. **Remove port management UI**
   - No more input/output sections
   - No more direction toggles
   - No more type (navigation/data) toggles

### Phase 3: Mini Graph in Screens Panel

**Files**: New component `src/panels/flows/MiniFlowGraph.tsx`

1. **Build a lightweight graph component**
   - Uses simple SVG or absolute-positioned divs
   - Shows current screen at center, neighbors as connected nodes
   - Nodes are small pills (screen name + link count)
   - Edges are thin lines with arrow direction
   - Clicking a neighbor node switches to that screen

2. **Add to Screens panel toolbar**
   - Small graph area (200×120px) in the toolbar or as a collapsible section
   - Shows "3 links" count badge
   - Click to expand to full graph overlay

3. **Full graph overlay**
   - Reuse existing `FlowsView` component
   - Rendered as an overlay within Screens panel (not a separate sidebar view)
   - Toggle via toolbar button
   - Clicking a node switches screen and closes overlay

### Phase 4: Visual Hotspot Improvements

**Files**: `src/panels/ScreensPanel.tsx` (hotspot rendering)

1. **Always show hotspot highlights**
   - Remove the `screensCodeTab === "ports"` condition
   - Use thin `1px` borders with `--primary` color (not cyan)
   - 20% opacity background fill

2. **Add direction badges**
   - Small pill next to each hotspot showing "→ Checkout"
   - Uses 9px mono text, `--muted-foreground` color
   - Only visible on hover (to reduce clutter)

3. **Bidirectional highlighting**
   - Hovering hotspot in preview → highlight row in Links tab
   - Hovering row in Links tab → highlight hotspot in preview
   - Use a shared `hoveredHotspotId` state

### Phase 5: Cleanup

1. **Remove FlowsPanel** from sidebar
   - Remove from `App.tsx` view routing
   - Remove from sidebar navigation
   - Keep `FlowsView` component for reuse as overlay

2. **Remove port-related functions from navigation.ts**
   - `getDefaultPorts()` → keep but make internal
   - `updateScreenPorts()` → remove (hotspots replace ports)
   - `addHotspot()` → simplify (no port creation)

3. **Update all callers**
   - Search for `NavPort` imports and update
   - Search for `updateScreenPorts` calls and remove
   - Search for `ports` prop passing and update

---

## Migration Strategy

### Backward Compatibility

`loadNavigation()` handles both old and new formats:

```typescript
export async function loadNavigation(projectDir: string): Promise<Navigation> {
  const nav = await loadOldOrNewFormat(projectDir);
  
  // Auto-migrate old format
  if (nav.ports || nav.links) {
    nav.hotspots = migrateToHotspots(nav);
    delete nav.ports;
    delete nav.links;
    await saveNavigation(projectDir, nav);
  }
  
  return nav;
}
```

### Rollout Order

1. **Phase 1 first** — data model changes are backward-compatible
2. **Phase 2** — can ship alongside Phase 1 (new UI, old data works)
3. **Phase 3** — independent of Phase 2
4. **Phase 4** — visual polish, can ship anytime
5. **Phase 5** — cleanup, ship last after verifying everything works

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Generated router breaks | High | `syncGeneratedRouter` still produces same output — just derives ports internally |
| Old navigation.json not migrated | Medium | Migration runs on load, with fallback to old format |
| React Flow graph quality degrades in overlay | Low | Reuse existing FlowsView component unchanged |
| Hotspot labels are inaccurate | Low | `labelFromSelector` is best-effort; users can rename |
| Performance with many hotspots | Low | Hotspots are lightweight objects; no more overhead than current |

---

## Summary

**Before**: 4 concepts × 3 UIs × 4+ clicks = cognitive overload
**After**: 1 concept (hotspot) × 1 UI (Links tab) × 2 clicks = simple and direct

The Flows graph doesn't disappear — it becomes a visualization tool within Screens, not a
separate destination. Users create links where they see the elements (Screens panel), and
optionally view the topology (mini graph or full overlay).
