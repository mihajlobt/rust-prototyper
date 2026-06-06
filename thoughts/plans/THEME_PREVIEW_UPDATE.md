# Theme Preview & Design Tokens — Refined Implementation Plan

## Audit Corrections (what the original plan got wrong)

| Claim | Reality |
|---|---|
| "22 semantic color tokens" | **19** color tokens in `ColorTokens` (spec.ts) |
| "ThemesPanel.tsx (604 lines)" | **587 lines** currently |
| "604 → ~560 after removing Frame block" | **587 → ~522** (Frame block is ~65 lines) |
| "`ThemePreviewToolbar.tsx` — add view mode control" | File **already exists** at `src/panels/ThemePreviewToolbar.tsx` (60 lines, device + dark toggles) — must modify, not create |
| "The `__theme-preview` page is inaccessible from the Theme panel" | Partially wrong — it's accessible via the runner iframe in the panel, but the **static Frame is what currently renders** in the preview pane (not the generated app) |
| "DesignLanguageSpec defines all facet data (color, typography, spacing…)" | Actually **14 facets**: meta, color, typography, spacing, radii, shadows, borders, motion, components, iconography, layout, voice, content, antiPatterns |
| "`ThemePreviewToolbar.tsx` — new file" | Already exists |
| "3 view modes (Showcase / Tokens / Gallery)" | Showcase and Tokens are nearly redundant — **reduced to 2 modes** (see below) |

---

## What Already Exists (don't duplicate)

**`getThemePreviewTsx()`** in `src/lib/scaffold-shadcn.ts:153–454` generates the `__theme-preview` page for the *generated app*. It already implements: typography specimens, 19-color swatches (light + dark), spacing scale, radii, shadows, motion tokens, button/badge/input/tabs component samples — as a string template. The new preview components should mirror this structure in native React, not reinvent it.

**`ThemeCodeTabs.tsx`** (147 lines) already has a "Tokens" tab showing `design.json` in CodeMirror. The new view modes live in the **preview pane** (above), not the code pane (below). These are different surfaces.

---

## What We're Building

Replace the hardcoded `react-frame-component` `<Frame>` (which renders static HTML with inline `style={{ color: 'var(--primary)' }}`) with a real React component tree that:

1. Injects the theme CSS scoped to a single container class (no iframe)
2. Renders the app's actual shadcn/ui components inside that scope
3. Adds two view modes: **Preview** (all design tokens) and **Gallery** (component variants)

---

## Architecture

### Dropped: Third "Tokens" View Mode

Showcase + Tokens were redundant (both show all token facets). **Two modes only:**

- **Preview** — all 14 token facets visualized (colors, type scale, spacing bars, radii, shadows, motion, a few component samples). The at-a-glance view. Mirrors `getThemePreviewTsx()` content.
- **Gallery** — component-only. All shadcn variants: Button (6 variants), Badge, Input, Textarea, Card, Tabs, Select, Checkbox, Slider. No token display.

### New Files — `src/panels/theme-preview/`

| File | Est. lines | Purpose |
|---|---|---|
| `ThemeTokenPreview.tsx` | ~100 | Orchestrator. Manages `viewMode` state, injects scoped `<style>`, routes to Preview or Gallery, passes `scopeRef` down |
| `ThemeScopedStyle.tsx` | ~40 | Utility. `rescopeThemeCss(css)` — replaces `:root {}` with `.theme-preview-scope {}` and `.dark {}` with `.theme-preview-scope.dark {}` |
| `ColorSwatchGrid.tsx` | ~110 | 19 semantic color tokens as swatch cards. Reads computed oklch values via `getComputedStyle(scopeRef.current)`. Copy-on-click for CSS var name |
| `TypographyShowcase.tsx` | ~100 | Font family specimens (sans/mono/display/serif), type scale (xs → 4xl), weight strips |
| `SpacingVisualizer.tsx` | ~70 | Spacing scale as proportional horizontal bars with labels and computed px values |
| `ShapeTokens.tsx` | ~90 | Radii (sm/md/lg/full as rounded squares) + Shadows (sm/md/lg/xl elevation cards) in one file — too small to justify two files |
| `MotionDemos.tsx` | ~70 | Buttons that animate on click to demonstrate `fast`/`normal`/`slow` duration tokens. Not decorative — triggered by user interaction only (DESIGN.md: "animate to communicate state") |
| `ComponentGallery.tsx` | ~180 | Real shadcn/ui components rendered inside `.theme-preview-scope`. Button × 6 variants, Badge, Input, Textarea, Card, Tabs, Select, Checkbox, Slider |

**Total: 8 new files, all under 200 lines.**

### Modified Files

| File | Change |
|---|---|
| `src/panels/ThemesPanel.tsx` | Replace `<Frame>` block (lines 444–523, ~65 lines) with `<ThemeTokenPreview css={css} isDark={themesDarkPreview} />` (~5 lines). Net: 587 → ~527 lines |
| `src/panels/ThemePreviewToolbar.tsx` | Add `viewMode / onSetViewMode` props. Add segmented control (Preview / Gallery) before existing device + dark toggles |
| `src/stores/projectSettingsStore.ts` | Add `themesPreviewMode: "preview" \| "gallery"` with default `"preview"` + coercion guard in `loadProject` |

> **Implementation note (post-plan relocation):** the `Tokens | Gallery` segmented control was *not* added to `ThemePreviewToolbar.tsx` as the table above describes. In the shipped implementation it lives in `src/panels/wizard/WizardPreviewPane.tsx` as a **floating** button group overlaid in the top-right of the Design tab's preview area (`absolute top-2 right-2 z-10 h-7 bg-background/80 backdrop-blur shadow-sm`), mirroring the Outline toggle in `src/panels/plans/PlanPreview.tsx:50`. The toolbar itself stays identical across all four Wizard tabs (device picker + dark mode + refresh + annotate).

---

## CSS Scoping — How It Works

The current `<Frame>` injects `parentCss` (all app stylesheets via `document.styleSheets`) + theme CSS into an iframe. The new approach eliminates the iframe entirely:

```typescript
// ThemeScopedStyle.tsx
export function rescopeThemeCss(rawCss: string): string {
  return rawCss
    .replace(/:root\s*\{/g, ".theme-preview-scope {")
    .replace(/\.dark\s*\{/g, ".theme-preview-scope.dark {");
}
```

The rescoped CSS is injected via a `<style>` tag appended to `document.head`. Because:

- App Tailwind CSS uses `--primary` etc. set on `:root` (specificity 0,1,0)
- Scoped theme CSS sets `--primary` on `.theme-preview-scope` (specificity 0,1,0)
- Equal specificity → **last declaration wins** — the `<style>` injected by the component renders after the app's CSS, so the theme's values win inside the scope ✓
- No `parentCss` needed — Tailwind classes (`bg-primary`, `text-foreground`, etc.) already resolve in the main document

**Dark mode:**

```tsx
<div
  ref={scopeRef}
  className={cn("theme-preview-scope", isDark && "dark")}
>
  ...children...
</div>
```

The `.theme-preview-scope.dark { --primary: ... }` rule fires when `.dark` is on the scope element. The app shell's own dark/light state is unaffected.

**Reading computed token values:**

```typescript
// Inside ColorSwatchGrid, after mount:
const scopeEl = scopeRef.current;
if (scopeEl) {
  const computed = getComputedStyle(scopeEl);
  const value = computed.getPropertyValue("--primary").trim(); // "oklch(0.922 0 0)"
}
```

Must run inside `useEffect` after mount. The ref is passed from `ThemeTokenPreview` down to sub-components.

---

## Critical Risks

**1. `:root` regex is fragile for unusual CSS.**
The theme generator output is controlled (generated by `getThemeCss()` in scaffold-shadcn.ts), so the `:root {` and `.dark {` patterns are deterministic. Still: run a guard — if no `:root` is found in the CSS, render a fallback message rather than crashing.

**2. `getComputedStyle` returns empty string if CSS var is not defined in scope.**
Handle gracefully: show `—` for unresolved tokens.

**3. `ComponentGallery` Tailwind classes resolve against the scope correctly only when the scoped CSS is fully loaded.**
Use a `useState(false)` / `useEffect(() => setReady(true))` pattern to defer gallery render until after the `<style>` tag is injected.

**4. The `<style>` tag must be cleaned up on unmount.**

```typescript
useEffect(() => {
  const tag = document.createElement("style");
  tag.textContent = rescopeThemeCss(css);
  document.head.appendChild(tag);
  return () => tag.remove();
}, [css]);
```

**5. `MotionDemos` must not animate on mount** — only on explicit click (DESIGN.md: "animate to communicate work… never to ornament").

---

## File Size Compliance

| File | Before | After |
|---|---|---|
| `ThemesPanel.tsx` | 587 | ~527 |
| `ThemePreviewToolbar.tsx` | 60 | ~95 |
| `projectSettingsStore.ts` | unchanged | +4 lines |

All new files: 40–180 lines. No violations.

---

## Dropped from Original Plan

- **"Design Tokens Screen (Future Phase)"** — removed entirely. Speculative scope with no concrete implementation path. Revisit after preview components ship.
- **Third "Tokens" view mode** — collapsed into Preview.
- **Separate `ShadowCards.tsx` + `RadiiShapes.tsx`** — merged into `ShapeTokens.tsx` (same visual pattern, too small to split).
- **`src/styles/theme-preview.css`** — no global CSS needed. The `.theme-preview-scope` selector is defined dynamically. Container rules (`overflow: hidden; height: 100%`) go inline on the scope div.

---

## Verification Checklist

- [ ] `rescopeThemeCss` replaces all `:root {` and `.dark {` in real theme output — verify with actual CSS string from `getThemeCss()`
- [ ] `getComputedStyle` reads correct token values when `.dark` is toggled
- [ ] `<style>` tag cleaned up on unmount (no memory leak)
- [ ] `ComponentGallery` renders after `<style>` is injected (no flash of unstyled content)
- [ ] `themesPreviewMode` persisted and coerced in `loadProject`
- [ ] `ThemesPanel.tsx` stays under 600 lines after replacement
- [ ] No animation fires on mount in `MotionDemos`
