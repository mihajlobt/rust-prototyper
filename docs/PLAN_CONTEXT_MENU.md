# Plan: Replace shadcn ContextMenu with Tauri Native Menu in Runner Panel

## Summary

Replace the web-based shadcn/ui ContextMenu components in RunnerPanel.tsx with Tauri v2's native menu API (`@tauri-apps/api/menu`). This provides native OS context menus with system styling.

**Important Discovery**: Tauri v2 has **built-in native menu support** — no plugin needed! The `tauri-plugin-context-menu` is for **Tauri v1 only**.

---

## Current Implementation Analysis

### RunnerPanel.tsx Context Menus (2 locations)

#### 1. File Tree Header Context Menu (lines 335-347)
| Item | Action |
|------|--------|
| New File... | Opens new file dialog |
| New Folder... | Creates new folder |
| Collapse All | Collapses all directories |
| ─ (separator) | |
| Show in File Explorer | Opens file in OS |
| Refresh | Reloads file tree |

#### 2. Tab Context Menu (lines 378-404)
| Item | Action |
|------|--------|
| Save | Saves current file |
| ─ (separator) | |
| Close | Closes current tab |
| Close Others | Closes all other tabs |
| Close to the Right | Closes tabs to the right |
| Close All | Closes all tabs |
| ─ (separator) | |
| Show in File Explorer | Opens file in OS |
| Rename... | Starts rename |
| Copy Path | Copies path to clipboard |
| ─ (separator) | |
| Delete | Deletes file |

---

## Implementation Plan

### Phase 1: Add Tauri Menu Permissions

1. Add to `src-tauri/capabilities/default.json`:
```json
{
  "permissions": [
    "menu:allow-new",
    "menu:allow-popup",
    "menu:allow-set-text",
    "menu:allow-set-enabled"
  ]
}
```

### Phase 2: Create Context Menu Utility

Create `src/lib/context-menu.ts`:

```typescript
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { getCurrentWindow } from '@tauri-apps/api/window';

export interface MenuAction {
  id: string;
  label: string;
  enabled?: boolean;
  items?: MenuAction[];
  separator?: boolean;
  shortcut?: string;
  action: () => void | Promise<void>;
}

/** Show a native context menu at the given position.
 *  Works in Tauri; falls back to no-op in browser/web. */
export async function showContextMenu(
  actions: MenuAction[],
  x: number,
  y: number
): Promise<void> {
  // Check if running in Tauri
  if (!isTauri()) {
    return;
  }

  // Build menu items recursively
  const menuItems = await buildMenuItems(actions);
  const menu = await Menu.new({ items: menuItems });
  
  // Popup at position relative to window
  const window = getCurrentWindow();
  await menu.popup({ x, y }, window);
}

/** Build MenuItem[] from MenuAction[] */
async function buildMenuItems(actions: MenuAction[]): Promise<MenuItem[]> {
  const items: MenuItem[] = [];
  
  for (const action of actions) {
    if (action.separator) {
      items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    } else if (action.items?.length) {
      // Submenu - recursive
      const submenu = await Submenu.new({
        text: action.label,
        items: await buildMenuItems(action.items),
      });
      items.push(submenu);
    } else {
      const item = await MenuItem.new({
        id: action.id,
        text: action.label,
        action: action.action,
        enabled: action.enabled ?? true,
      });
      items.push(item);
    }
  }
  
  return items;
}

/** Detect Tauri runtime */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}
```

### Phase 3: Update RunnerPanel.tsx

Replace shadcn ContextMenu with native menu calls:

#### 3.1 File Tree Header Context Menu

Replace:
```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <span className="text-xs font-medium text-muted-foreground cursor-default">Files</span>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onClick={...}>...</ContextMenuItem>
    ...
  </ContextMenuContent>
</ContextMenu>
```

With:
```tsx
// On right-click handler for native menu
const handleFileTreeContextMenu = (e: React.MouseEvent) => {
  e.preventDefault();
  showContextMenu([
    { id: 'new-file', label: 'New File...', action: () => { setNewFileParentDir(generatedDir); setShowNewFile(true); } },
    { id: 'new-folder', label: 'New Folder...', action: () => startNewFolder(generatedDir) },
    { id: 'collapse-all', label: 'Collapse All', action: () => setExpandedDirs(new Set()) },
    { id: 'sep1', label: '', separator: true },
    { id: 'reveal', label: 'Show in File Explorer', action: () => revealInExplorer(generatedDir) },
    { id: 'refresh', label: 'Refresh', action: loadFiles },
  ], e.clientX, e.clientY);
};

// In the JSX:
<span 
  className="text-xs font-medium text-muted-foreground cursor-default"
  onContextMenu={handleFileTreeContextMenu}
>
  Files
</span>
```

#### 3.2 Tab Context Menu

Similar transformation for tab context menu at line 378-404.

### Phase 4: Preserve shadcn ContextMenu as Fallback

Optionally keep shadcn ContextMenu for web/preview builds where native menu isn't available:

```tsx
// Detect Tauri vs web
const isTauri = typeof window !== 'undefined' && '__TAURI__' in window;

{isTauri ? (
  // Native menu via onContextMenu
  <button onContextMenu={handleTabContextMenu} ... />
) : (
  // shadcn ContextMenu for web preview
  <ContextMenu>
    ...
  </ContextMenu>
)}
```

---

## Action Mapping Reference

| Original Action | Native Menu Equivalent |
|-----------------|---------------------|
| `<ContextMenu>` + `<ContextMenuTrigger asChild>` | `onContextMenu` handler |
| `<ContextMenuContent>` | `Menu.new({ items: [...] })` |
| `<ContextMenuItem onClick={fn}>` | `MenuItem.new({ id, text, action: fn })` |
| `<ContextMenuSeparator />` | `PredefinedMenuItem.new({ item: 'Separator' })` |
| `disabled={bool}` | `enabled: !bool` |
| `className="text-destructive"` | Custom styling not supported — text in menu item |

---

## Files to Modify

| File | Changes |
|------|--------|
| `src-tauri/capabilities/default.json` | Add menu permissions |
| `src/lib/context-menu.ts` | **NEW** — native menu utility |
| `src/panels/RunnerPanel.tsx` | Replace ContextMenu with native |

---

## Testing Checklist

- [ ] File tree header right-click shows native menu
- [ ] All menu items functional
- [ ] Tab right-click shows native menu  
- [ ] Menu dismisses on click outside
- [ ] Works in both Tauri and web preview modes
- [ ] No regression in existing functionality