---
title: Annotation → Element Targeting for AI Preview Generation
date: 2026-06-15
status: research
---

# Annotation → Element Targeting for AI Preview Generation

## 1. Problem statement

Prototyper's Wizard mode lets a user drop a pin or draw a rectangle on the live
preview and attach a text note ("make this button bigger"). Today this is
implemented purely in **percentage coordinates** of the overlay div:

- `src/components/ui/AnnotationOverlay.tsx` — `Annotation { type, x, y, w?, h?, text }`,
  all in `%` of the overlay's bounding box.
- `src/panels/create/CreatePreviewPane.tsx` — `getRelativeCoords()` converts a
  mouse event to `%` of `overlayRef`'s `getBoundingClientRect()`.
- `src/panels/create/modes/WizardMode.tsx` — `serializeAnnotations()` turns the
  array into a `[VISUAL ANNOTATIONS]` text block like:
  `"1. (point) at 42%, 18% — make this button bigger"`.
- `src/lib/prompts/wizard.ts` — tells the model: *"each annotation describes a
  specific area of the UI... use this spatial context to make targeted edits."*

**Why this is not enough:**

1. The model receives two numbers and a sentence. It has no idea which JSX
   element, file, or component those numbers correspond to — it has to guess
   from the screenshot-less description and the screen's source code.
2. The preview is a **responsive, fluid layout** rendered in an iframe at
   whatever size the pane happens to be. `42%, 18%` on a 1400px-wide pane and
   on a 375px "mobile" preview (`DEVICE_WIDTHS.mobile = 375`) point at
   completely different DOM elements. Coordinates captured at annotation time
   are not stable even within the same session if the user resizes the
   Allotment pane or switches device width afterward.
3. Region annotations are even worse — a `%` rectangle says nothing about
   whether it covers one element, a whole section, or three unrelated
   components.

The fix is to **resolve the click/drag to an actual DOM element (or small set
of elements) at annotation time**, and serialize *that* — not raw coordinates
— into the prompt. Position becomes a *UI affordance* (where to draw the pin
on screen) but not part of the model-facing payload.

## 2. What Prototyper already has (and isn't using for this)

This is the most important finding: **Prototyper already built most of the
plumbing needed**, for a different feature (Flows / hotspot linking in
Screens mode), and the Wizard annotation flow simply doesn't call into it.

`src/lib/scaffold-shadcn/main-template.ts` is injected into every generated
app's `main.tsx` and runs inside the preview iframe. It already implements a
`postMessage` bridge with:

- **`getSelector(el)`** (lines 187–201) — walks up from an element to
  `document.body`, building a structural CSS selector path using
  `tag` or `tag:nth-of-type(n)` per level (e.g.
  `main > section:nth-of-type(2) > div > button:nth-of-type(1)`). This is a
  **DOM-structure selector, not a coordinate** — it survives resizing,
  reflow, and responsive breakpoints as long as the structure itself doesn't
  change.
- **`find-element-at`** (lines 109–127) — parent posts `{x, y}` (viewport
  px inside the iframe), iframe replies with
  `{ type: 'hotspot-created', selector, rect: {x,y,w,h} }`.
- **`enable-element-select` / `enable-link-mode`** (lines 71–184) — full
  click-to-select flows that reply with
  `{ elementTag, elementText, elementId, selector, rect }`.
- The host side (`src/hooks/useHotspotTracking.ts`) already has the
  `window.addEventListener("message", ...)` half of this bridge, and
  `src/panels/create/CreatePreviewPane.tsx` already listens for
  `__route-change` postMessages from the same injected script.

None of this is wired into `AnnotationOverlay` / `AnnotationTray` /
`serializeAnnotations()`. The Wizard annotation feature was built before (or
independently of) the hotspot-linking feature and never adopted the selector
infrastructure.

## 3. How comparable tools solve "which element am I talking about"

Researched: **Onlook** (open-source, MIT, "Cursor for Designers"), **v0 by
Vercel**, **bolt.new** (StackBlitz), **stagewise** (open-source AGPL browser
toolbar for AI coding agents), and the two "Claude Design" alternatives named
in the prompt — **Open CoDesign** (`OpenCoworkAI/open-codesign`) and
**open-design** (`nexu-io/open-design`).

| Tool | Mechanism | Coordinate-free? |
|---|---|---|
| **Onlook** | Instruments the served bundle at build time with `data-oid` attributes (via AST/babel transform) that map every DOM node 1:1 to a JSX node in source. Click → right-click → jumps straight to the exact JSX in the IDE; edits write back through the `oid` → JSX → HMR. | Yes — identity is the `oid`, a stable ID baked into the markup, not a position. |
| **v0 (Vercel)** | "Inline edit" mode: click an element in the live preview to select it; the selection becomes a scoped edit target ("change this button's variant") vs. chat follow-ups which apply globally. Backed by Next.js/React preview where elements are addressable components. | Yes — selection is element-scoped, not pixel-scoped. |
| **bolt.new** | "Select" tool in the chat box: click an element, then a "Choose Element" layer panel lets you pick the exact ancestor (e.g. card vs. the button inside it) before it's attached as a context chip to the prompt. | Yes — explicitly resolves to a layer/element with a fallback UI for ambiguity (parent vs. child). |
| **stagewise** | Browser toolbar usable with any framework (React/Vue/Svelte/Angular plugins). Click-select a DOM element; it captures element metadata + a screenshot and sends it as context to an IDE agent (Cursor/Windsurf). Framework plugins add source-mapping where available. | Yes — element + screenshot, not coordinates. |
| **Open CoDesign / open-design** | Both are young/early. `open-design` renders artifacts in a sandboxed `srcdoc` iframe and explicitly documents **"comment-mode surgical edits — partially shipped; reliable targeted patching in progress"** — i.e. they've identified the exact same gap Prototyper has and haven't fully solved it yet. | Not yet — acknowledged open problem. |

### The two underlying techniques

**(a) Structural DOM selector** (what Prototyper's `getSelector()` already
does). Resilient to resizing/breakpoints because it's based on tree
structure, not pixels. Weakness: breaks if the JSX conditionally renders
different element types/orders at different breakpoints (rare in generated
shadcn layouts, but possible with `md:hidden`/`md:flex` patterns).

**(b) Source-location mapping** (`file:line:column` of the JSX element that
rendered the clicked DOM node). This is what Onlook's `data-oid` and tools
like `react-dev-inspector` / "Locator.js" do under the hood via React's
fiber tree: in dev mode, `@vitejs/plugin-react`'s JSX transform used to embed
`fileName`/`lineNumber`/`columnNumber` on every element, retrievable from a
DOM node via its `__reactFiber$...` key → `fiber._debugSource`.

**Caveat for Prototyper specifically:** React 19 **removed `_debugSource`
from the fiber** by default (facebook/react#29092, #32574) — tools relying on
it broke and the ecosystem hasn't fully replaced it yet (some restore it via
`@babel/plugin-transform-react-jsx-development`, but `@vitejs/plugin-react`'s
default config in React 19.2+ doesn't reliably populate it per
babel/babel#17571). Since Prototyper's generated apps are scaffolded with
current shadcn/Vite/React 19, **(b) is currently fragile/version-dependent**
and would require either pinning a babel plugin in the scaffold's
`vite.config.ts` or injecting `data-oid`-style attributes ourselves (Onlook's
approach) at scaffold/edit time — a bigger lift.

**(a) is the pragmatic near-term win** because the selector-generation code
already exists, is framework-version-independent (pure DOM API), and is
already proven inside this codebase for hotspot linking.

## 4. Recommended approach

### Tier 1 — Resolve annotations to elements via the existing selector bridge (small, high value)

When the user commits an annotation in `CreatePreviewPane.commitAnnotation()`:

1. Convert the click/drag-center position to iframe-viewport px (the
   `getRelativeCoords` math already does the `%`; multiply back by the
   iframe's `getBoundingClientRect()` — or just keep the raw px from the
   original mouse event before converting to `%`).
2. `postMessage({ type: 'find-element-at', x, y, portId: annotationId })` to
   the iframe (reuse the existing handler in `main-template.ts:109`).
3. iframe replies `{ type: 'hotspot-created', portId, selector, rect }` —
   listen for this in `CreatePreviewPane` (parallel to the existing
   `__route-change` listener) and attach `selector`, `elementTag`,
   `elementText` to the annotation.
4. For **region** annotations, sample a few points (center + 4 corners),
   resolve each, and pick the **shallowest common ancestor selector** (or, if
   they're all the same element, just that element) — gives the model "this
   `<section>`" instead of "this `<span>` inside it".

Extend `Annotation`:

```ts
export interface Annotation {
  id: string
  type: "point" | "region"
  x: number; y: number; w?: number; h?: number   // keep for the visual pin
  text: string
  resolved?: boolean
  // NEW — resolved at commit time via find-element-at
  selector?: string        // e.g. "main > section:nth-of-type(2) > button"
  elementTag?: string       // "button"
  elementText?: string      // visible text, first ~50 chars
}
```

### Tier 1b — Rewrite `serializeAnnotations()` to be element-first

Current format (coords-first):
```
1. (point) at 42%, 18% — make this button bigger
```

Proposed format (element-first, coords as a hint only):
```
1. <button> "Get Started" (selector: main > section:nth-of-type(2) > button)
   — make this button bigger
```

And update the system prompt (`src/lib/prompts/wizard.ts`) to tell the model
the selector is a **CSS selector path it can use to locate the element in the
screen's JSX** (match by tag/structure/text, not by literally querying the
DOM), e.g.:

> ANNOTATION CONTEXT — each annotation includes the target element's tag,
> visible text, and a structural CSS selector describing its position in the
> DOM tree (e.g. `main > section:nth-of-type(2) > button`). Use the tag, text,
> and ancestor chain to find the corresponding JSX element in the screen's
> source — selectors are positional, not literal class names to add.

### Tier 2 — Source-location mapping (future, bigger lift)

If selector-based targeting proves ambiguous in practice (e.g. generated
JSX has many structurally-identical siblings — common with `.map()` lists),
the next step is Onlook-style instrumentation: inject a Babel/SWC plugin into
the generated app's `vite.config.ts` that stamps every top-level JSX element
with `data-loc="src/screens/Home.tsx:42:8"`. `getSelector()`'s walk can then
prefer the nearest ancestor with `data-loc` and report `file:line` directly —
removing all selector ambiguity. This is strictly additive to Tier 1 (same
postMessage bridge, just richer reply payload) and can be scoped to dev-only
output so it never ships in `export_project`/`export_component`.

Given the React 19 `_debugSource` breakage, **do not** rely on fiber
inspection — do the attribute-stamping at the JSX/AST level during scaffold
generation instead (Prototyper already post-processes generated `vite.config.ts`
— see `constants.ts` `patchViteConfigFsAllow`/`patchViteConfigDedupe` for the
existing pattern of programmatic config patches).

### Visual marker positioning under resize (separate from targeting)

Once an annotation has a `selector`, the *pin position* can be kept accurate
across resizes for the duration of the session: on `__route-change` /
`resize`, re-run `querySelector(selector)` + `getBoundingClientRect()` inside
the iframe (same mechanism as `sendHotspotPositions()` in
`main-template.ts:30`) and reposition the overlay marker in px instead of
relying on the original `%`. This is a nice-to-have UX polish, independent of
the model-facing fix.

## 5. Implementation touchpoints (file-by-file)

| File | Change |
|---|---|
| `src/lib/scaffold-shadcn/main-template.ts` | No new message types needed for Tier 1 — `find-element-at`/`hotspot-created` already exist. For region annotations, optionally add a `find-elements-in-rect` variant. |
| `src/components/ui/AnnotationOverlay.tsx` | Add `selector?`, `elementTag?`, `elementText?` to `Annotation`. No render changes required (pin/tooltip UI unchanged). |
| `src/panels/create/CreatePreviewPane.tsx` | In `commitAnnotation()`, postMessage `find-element-at` (reuse existing path used by hotspot tracking) with the raw px coords captured during drag; listen for `hotspot-created` keyed by a per-annotation `portId` and merge the result into the annotation before calling `onAddAnnotation`. |
| `src/panels/create/modes/WizardMode.tsx` | Rewrite `serializeAnnotations()` to the element-first format above. |
| `src/lib/prompts/wizard.ts` | Update the `ANNOTATION CONTEXT` paragraph to describe selectors as structural hints, not literal DOM queries. |
| `src/hooks/useHotspotTracking.ts` | Reference only — confirms the `message` listener pattern to copy for the annotation resolver. |

## 6. Open risks / questions

- **Selector ambiguity for list items**: `getSelector()` produces e.g.
  `ul > li:nth-of-type(3) > span`, which is positionally correct but the model
  must understand "3rd item" maps to `.map((item, i) => ...)` in source — likely
  fine since the model already reads the file, this is just a *pointer*.
- **iframe not yet mounted / element not rendered** when annotation is
  committed quickly (React renders async) — `sendHotspotPositions()` already
  has a retry-with-rAF pattern (`main-template.ts:46-52`) that should be
  mirrored for `find-element-at` if it's called before first paint.
- **Cross-origin iframe**: the preview iframe is served from a separate Vite
  dev-server port, so `contentDocument` access is blocked — but the existing
  `postMessage` bridge already works around this (`'*'` targetOrigin), so no
  new CORS/CSP work needed.
- **Export builds**: any Tier 2 instrumentation must be stripped from
  `export_project`/`export_component` output (dev-only Vite plugin, or guard
  on `import.meta.env.DEV`).
