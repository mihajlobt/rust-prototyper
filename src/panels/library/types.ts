import type { ItemMeta } from "@/lib/item-meta";

export type ItemType = "component" | "theme" | "screen" | "api";
export type SortKey = "updated" | "name" | "type";
export type ViewMode = "list" | "gallery";

export interface LibraryItem {
  id: string;
  name: string;
  type: ItemType;
  meta: ItemMeta | null;
  palette?: string[];
}

export const TYPE_COLORS: Record<ItemType, string> = {
  screen:    "text-sky-400",
  component: "text-violet-400",
  theme:     "text-rose-400",
  api:       "text-amber-400",
};

export const TYPE_BG: Record<ItemType, string> = {
  screen:    "bg-sky-400/10",
  component: "bg-violet-400/10",
  theme:     "bg-rose-400/10",
  api:       "bg-amber-400/10",
};

export const TYPE_LABELS: Record<ItemType, string> = {
  screen: "Screen", component: "Component", theme: "Theme", api: "API",
};

export const SORT_LABELS: Record<SortKey, string> = {
  updated: "Recent", name: "Name", type: "Type",
};

export const ALL_TYPES: ItemType[] = ["screen", "component", "theme", "api"];

export interface RowActions {
  openItem: (item: LibraryItem) => void;
  startRename: (item: LibraryItem) => void;
  commitRename: (item: LibraryItem) => void;
  copyPrompt: (item: LibraryItem) => void;
  handleDuplicate: (item: LibraryItem) => void;
  handleExport: (item: LibraryItem) => void;
  handleDelete: (item: LibraryItem) => void;
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
}

export const PALETTE_KEYS = [
  "--background", "--primary", "--secondary", "--accent", "--destructive",
];

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function stripMentionBlocks(text: string): string {
  return text.replace(/<!-- @[^>]+ -->\n[\s\S]*?<!-- end @[^>]+ -->\n\n?/g, "").trim();
}

export function extractPalette(css: string): string[] {
  return PALETTE_KEYS
    .map((key) => css.match(new RegExp(`${key}:\\s*([^;\\n]+)`))?.[1]?.trim())
    .filter(Boolean) as string[];
}
