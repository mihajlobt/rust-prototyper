/** Native context menu utility using Tauri v2 menu API.
 *  Provides native OS context menus with system styling.
 *  Falls back to no-op in web/preview builds. */
import { Menu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";

/** Menu action configuration */
export interface MenuAction {
  /** Unique identifier for the action */
  id: string;
  /** Display text in the menu */
  label: string;
  /** Whether the item is disabled */
  enabled?: boolean;
  /** Submenu items */
  items?: MenuAction[];
  /** Whether this is a separator */
  separator?: boolean;
  /** Callback when clicked */
  action: () => void | Promise<void>;
}

/** Detect if running in Tauri renderer.
 *  Based on Tauri v2 detection pattern from official docs. */
function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

/** Show a native context menu at the given screen position.
 *  In web/preview (non-Tauri), this is a no-op.
 *  
 *  API reference:
 *  https://v2.tauri.app/reference/javascript/api/namespace/menu */
export async function showContextMenu(
  actions: MenuAction[],
  clientX: number,
  clientY: number
): Promise<void> {
  if (!isTauri()) {
    return;
  }

  try {
    // Build menu items from actions
    const menuItems = await buildMenuItems(actions);
    const menu = await Menu.new({ items: menuItems });

    // Popup at position relative to window
    const window = getCurrentWindow();
    const position = new LogicalPosition(clientX, clientY);
    await menu.popup(position, window);
  } catch (error) {
    // Log but don't throw - graceful degradation in dev
    console.warn("Failed to show context menu:", error);
  }
}

/** Build MenuItem[] recursively from MenuAction[].
 *  Tauri v2 menu API: MenuItem, PredefinedMenuItem for separators. */
async function buildMenuItems(
  actions: MenuAction[]
): Promise<(MenuItem | PredefinedMenuItem)[]> {
  const items: (MenuItem | PredefinedMenuItem)[] = [];

  for (const action of actions) {
    if (action.separator) {
      items.push(await PredefinedMenuItem.new({ item: "Separator" }));
    } else if (action.items?.length) {
      // Flatten submenu items into parent (native menus don't always support submenus well)
      items.push(...(await buildMenuItems(action.items)));
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

/** Convenience: create actions for file tree context menu. */
export function createFileTreeActions(config: {
  onNewFile: () => void;
  onNewFolder: () => void;
  onCollapseAll: () => void;
  onReveal: () => void;
  onRefresh: () => void;
}): MenuAction[] {
  return [
    { id: "new-file", label: "New File...", action: config.onNewFile },
    { id: "new-folder", label: "New Folder...", action: config.onNewFolder },
    { id: "collapse-all", label: "Collapse All", action: config.onCollapseAll },
    { id: "sep-1", label: "", separator: true, action: () => {} },
    { id: "reveal", label: "Show in File Explorer", action: config.onReveal },
    { id: "refresh", label: "Refresh", action: config.onRefresh },
  ];
}

/** Convenience: create actions for tab context menu. */
export function createTabActions(config: {
  onSave: () => void;
  onClose: () => void;
  onCloseOthers: () => void;
  onCloseToRight: () => void;
  onCloseAll: () => void;
  onReveal: () => void;
  onRename: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
  canCloseOthers?: boolean;
  canCloseToRight?: boolean;
}): MenuAction[] {
  return [
    { id: "save", label: "Save", action: config.onSave },
    { id: "sep-1", label: "", separator: true, action: () => {} },
    { id: "close", label: "Close", action: config.onClose },
    {
      id: "close-others",
      label: "Close Others",
      enabled: config.canCloseOthers ?? true,
      action: config.onCloseOthers,
    },
    {
      id: "close-to-right",
      label: "Close to the Right",
      enabled: config.canCloseToRight ?? true,
      action: config.onCloseToRight,
    },
    { id: "close-all", label: "Close All", action: config.onCloseAll },
    { id: "sep-2", label: "", separator: true, action: () => {} },
    { id: "reveal", label: "Show in File Explorer", action: config.onReveal },
    { id: "rename", label: "Rename...", action: config.onRename },
    { id: "copy-path", label: "Copy Path", action: config.onCopyPath },
    { id: "sep-3", label: "", separator: true, action: () => {} },
    { id: "delete", label: "Delete", action: config.onDelete },
  ];
}