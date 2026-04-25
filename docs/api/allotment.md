# Allotment — React Split-Pane Component

> Source: https://github.com/johnwalley/allotment (README)
> Version: latest (npm: allotment)

## Installation

```sh
bun add allotment
```

## Usage

```jsx
import { Allotment } from "allotment";
import "allotment/dist/style.css";

<Allotment>
  <ComponentA />
  <ComponentB />
</Allotment>
```

## Allotment Props (all optional)

| Prop | Default | Description |
|------|---------|-------------|
| `defaultSizes` | — | Array of initial sizes (pixels or proportional). If sum ≠ container size, sizes scale proportionally. |
| `maxSize` | `Infinity` | Maximum size of any pane. |
| `minSize` | `30` | Minimum size of any pane. |
| `proportionalLayout` | `true` | Resize views proportionally when container resizes. |
| `separator` | `true` | Render separator between panes. |
| `snap` | `false` | Enable snap-to-zero for all panes. |
| `vertical` | `false` | Stack panes vertically. |
| `onChange` | — | Callback on pane size change (usually on drag). Receives `number[]`. |
| `onDragStart` | — | Callback when user clicks a sash. |
| `onDragEnd` | — | Callback when user stops dragging a sash. Receives `number[]`. |
| `onReset` | — | Callback when user double-clicks a sash. |
| `onVisibleChange` | — | Callback when pane visibility changes via snapping. Receives `(index: number, visible: boolean)`. Only fires if new value differs from current `visible` prop. |

## Allotment.Pane Props

| Prop | Default | Description |
|------|---------|-------------|
| `minSize` | — | Minimum size of this pane. Overrides parent `minSize`. |
| `maxSize` | — | Maximum size of this pane. Overrides parent `maxSize`. |
| `priority` | `NORMAL` | Pane priority for layout algorithm (`HIGH`, `NORMAL`, `LOW`). Only used when `proportionalLayout={false}`. |
| `preferredSize` | — | Preferred size (number = px, string = `"150px"` or `"50%"`). Used on initial mount, when adding panes, and on reset. |
| `snap` | — | Enable snap-to-zero for this pane. Overrides parent `snap`. |
| `visible` | `true` | Whether the pane should be visible. **Use this to declaratively show/hide panes.** |

## Programmatic Control

```jsx
const ref = React.useRef<AllotmentHandle>(null);

// Reset to defaultSizes
ref.current?.reset();

// Resize panes to specific sizes
ref.current?.resize([100, 200]);
```

**IMPORTANT**: `resize()` must only be called **after** the Allotment component has fully mounted and laid out its panes. Calling `resize()` in `useEffect` on mount or in `requestAnimationFrame` on mount can cause `TypeError: undefined is not an object (evaluating 'pane.minimumSize')` because the internal pane layout has not been computed yet.

### Safe pattern for programmatic resize

```tsx
// ❌ UNSAFE — crashes on mount because panes haven't laid out yet
useEffect(() => {
  ref.current?.resize([100, 200]); // TypeError!
}, []);

// ❌ UNSAFE — requestAnimationFrame is still too early
useEffect(() => {
  requestAnimationFrame(() => {
    ref.current?.resize([100, 200]); // TypeError!
  });
}, []);

// ✅ SAFE — resize in response to user interaction (event handlers)
<button onClick={() => ref.current?.resize([100, 200])}>Resize</button>

// ✅ SAFE — resize in response to state change AFTER initial mount
const [mounted, setMounted] = useState(false);
useEffect(() => { setMounted(true); }, []);
useEffect(() => {
  if (!mounted) return;
  ref.current?.resize([100, 200]);
}, [mounted, someOtherDep]);

// ✅ BEST — use `visible` prop for show/hide, and `defaultSizes` for initial layout
<Allotment.Pane visible={isOpen} preferredSize={isOpen ? 280 : 28}>
  {isOpen && <Content />}
</Allotment.Pane>
```

## Visible Pane Control (Recommended for Collapse/Expand)

The `visible` prop on `Allotment.Pane` is the **recommended way** to collapse/expand panes. It avoids the need for imperative `resize()` calls entirely:

```tsx
function Example() {
  const [sidebarVisible, setSidebarVisible] = useState(true);

  return (
    <Allotment snap onVisibleChange={(index, visible) => {
      if (index === 0) setSidebarVisible(visible);
    }}>
      <Allotment.Pane visible={sidebarVisible} preferredSize={200}>
        <Sidebar />
      </Allotment.Pane>
      <Allotment.Pane>
        <MainContent />
      </Allotment.Pane>
    </Allotment>
  );
}
```

## Styling

CSS variables for customization:

```css
:root {
  --focus-border: #007fd4;
  --separator-border: rgba(128, 128, 128, 0.35);
}
```

Use `setSashSize(pixels)` to control the drag handle size.

## Key Classes

| Class | Description |
|-------|-------------|
| `.split-view` | Top-level container |
| `.split-view-view` | Applied to each pane view |
| `.split-view-view-visible` | Applied to visible panes |
| `.sash` | The divider between panes |
| `.sash-active` | Divider while being dragged |

## FAQ

- **Not working?** Ensure the container has explicit height/width and CSS is imported: `import "allotment/dist/style.css"`.
- **Scrolling?** Wrap content in `<div style={{ width: "100%", height: "100%", overflow: "auto" }}>`.
- **Lock pane size?** Set `minSize` and `maxSize` to the same value.