<!-- Context: prototyper/panels/assets/guides/ui-patterns | Priority: high | Version: 1.1 | Updated: 2026-06-04 -->

# Assets Panel UI Patterns

> Reusable UI patterns from the Assets panel. These solve specific desktop-app layout problems (sticky controls in scroll containers, view toggles, lightbox safety).

## Sticky Toolbar Inside Scroll Container

The gallery lives inside `overflow-auto`, but the toolbar must remain visible:

```tsx
<div className="flex-1 overflow-auto">
  <div className="sticky top-0 z-10 flex justify-end items-center gap-1 px-2 py-1">
    {/* view toggle, refresh, sort */}
  </div>
  <AssetGrid ... />
</div>
```

- `sticky top-0` pins the bar to the scroll viewport, not the window.
- No background color — the bar is transparent so content scrolls behind it naturally.
- Right-aligned button cluster with `justify-end`.

**Code**: `src/panels/AssetsPanel.tsx` — assets grid wrapper

## Grid View: Responsive Auto-Fill

```tsx
<div className="grid gap-2 px-3 pb-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
```

- `auto-fill` + `minmax(200px, 1fr)` gives responsive columns without media queries.
- Cards are uniform; the last row fills evenly.

## Grid Thumbnail Overlay (Hover-Only)

```tsx
<div className="... group">
  <img ... />
  {/* Delete button — appears on hover */}
  <button className="opacity-0 group-hover:opacity-100 transition-opacity ..." />
  {/* Metadata overlay — gradient + text-shadow */}
  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/80 to-black/0 ...
                  opacity-0 group-hover:opacity-100 transition-opacity">
    <div className="text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
      {asset.prompt}
    </div>
  </div>
</div>
```

- `group-hover` keeps the DOM light — no JS state for hover.
- Gradient + `text-shadow` ensures readability over any image content.

**Code**: `src/panels/assets/AssetGrid.tsx` — `AssetCardGrid`

## List View: Dense Row with Inline Thumbnail

```tsx
<button className="... flex items-start gap-2 px-3 py-1.5 border-b ...">
  <img className="w-10 h-10 rounded-sm object-cover shrink-0 ..." />
  <div className="flex-1 min-w-0">
    <div className="text-xs leading-tight">{prompt ?? file_name}</div>
    <div className="text-[10px] font-mono text-muted-foreground">
      {file_name} | {size}KB
    </div>
  </div>
  <button className="opacity-0 hover:text-destructive ...">
    <Trash2 size={12} />
  </button>
</button>
```

- `min-w-0` on the text container is required for `truncate`/`text-ellipsis` to work inside flex.
- Delete button is always in the row but invisible until hover.

**Code**: `src/panels/assets/AssetGrid.tsx` — `AssetCardList`

## Context Menu

Uses Radix `ContextMenu` (not `DropdownMenu`) for right-click:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div>...</div>
  </ContextMenuTrigger>
  <ContextMenuContent className="w-48">
    <ContextMenuItem onClick={onReveal}>
      <FolderOpen size={12} className="mr-2" /> Show in File Explorer
    </ContextMenuItem>
    <ContextMenuItem onClick={onCopyPrompt} disabled={!asset.prompt}>
      <Copy size={12} className="mr-2" /> Copy Prompt
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onClick={onDelete} className="text-destructive ...">
      <Trash2 size={12} className="mr-2" /> Delete
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

**Note**: `ContextMenu.Root` is **uncontrolled only** — it does not accept an `open` prop. For controlled menus (e.g. left-click), use `DropdownMenu.Root` with `open`/`onOpenChange`.

**Code**: `src/panels/assets/AssetGrid.tsx`

## Custom Lightbox (No External Library)

We avoid `yet-another-react-lightbox-lite` because it crashes WebKitGTK on Linux/Wayland.

```tsx
// Portal-based overlay outside Allotment
{createPortal(
  <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95"
       onClick={handleClose}>
    {/* Top bar, prev/next buttons, image, metadata */}
  </div>,
  document.body
)}
```

- `z-[9999]` ensures it floats above everything including Allotment panes.
- `document.body` portal prevents the image from being clipped by `overflow-hidden` ancestors.
- Keyboard: `Escape` closes, `ArrowLeft`/`ArrowRight` navigates.
- Body scroll is locked while open.

**Code**: `src/panels/assets/AssetPreviewLightbox.tsx`

## Highlight Animation on New Asset

When an image finishes generating, the card flashes to draw attention:

```css
@keyframes asset-highlight {
  0% { background-color: oklch(0.7 0.15 180 / 0.3); }
  100% { background-color: transparent; }
}
.asset-highlight {
  animation: asset-highlight 1.5s ease-out;
}
```

```tsx
// AssetsPanel.tsx
const [highlightFileName, setHighlightFileName] = useState<string | undefined>();
useEffect(() => {
  if (bonsai.lastResult?.file_name) {
    setHighlightFileName(bonsai.lastResult.file_name);
    const timer = setTimeout(() => setHighlightFileName(undefined), 2000);
    return () => clearTimeout(timer);
  }
}, [bonsai.lastResult?.file_name]);
```

- `scrollIntoView({ behavior: "smooth", block: "nearest" })` is triggered from a ref inside the card when `isHighlighted` is true.
- The highlight class is removed after 2s so it doesn't re-trigger on re-renders.

**Code**: `src/styles/globals.css`, `src/panels/assets/AssetGrid.tsx`

## Per-Project Persistence

Assets panel UI state is stored per-project via `projectSettingsStore` (Tauri Store plugin):

```ts
assetsViewMode: "list" | "grid"
assetsShowLog: boolean
assetsSortOrder: "newest" | "oldest" | "largest" | "smallest" | "name"
```

Updates are optimistic in Zustand and flushed to disk with a 400ms debounce.

**Code**: `src/stores/projectSettingsStore.ts`

## Pane Size Persistence

```ts
const { ref: allotmentRef, onDragEnd, defaultSizes } =
  useAllotmentLayout("assets", 2, [true, ps.assetsShowLog]);
```

- Key `"assets"` stores sizes in `settings.layout.assets`.
- `paneVisible` array hides the log pane when `assetsShowLog` is false without losing the saved split.
- `onVisibleChange` on `Allotment` syncs pane visibility back to settings.

**Code**: `src/hooks/useAllotmentLayout.ts`

## Related

- **Panel architecture** → `assets-panel.md`
- **Bonsai backend** → `bonsai-backend.md`
