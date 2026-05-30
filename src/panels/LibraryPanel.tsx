import { useState } from "react";
import { Box, Palette, LayoutGrid, Globe, Search, ChevronDown, ChevronRight, Clock, Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readDir, readFile, writeFile, deleteDir, deleteFile, renameFile, createDir, getErrorMessage } from "@/lib/ipc";
import { save, confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { projectKeys } from "@/lib/queryKeys";
import type { ItemMeta } from "@/lib/item-meta";

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemType = "component" | "theme" | "screen" | "api";
type SortKey = "updated" | "name" | "type";

interface LibraryItem {
  id: string;
  name: string;
  type: ItemType;
  meta: ItemMeta | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<ItemType, string> = {
  screen:    "text-sky-400",
  component: "text-violet-400",
  theme:     "text-rose-400",
  api:       "text-amber-400",
};

const TYPE_BG: Record<ItemType, string> = {
  screen:    "bg-sky-400/10",
  component: "bg-violet-400/10",
  theme:     "bg-rose-400/10",
  api:       "bg-amber-400/10",
};

const TYPE_ICONS: Record<ItemType, React.ReactNode> = {
  screen:    <LayoutGrid size={12} />,
  component: <Box size={12} />,
  theme:     <Palette size={12} />,
  api:       <Globe size={12} />,
};

const TYPE_LABELS: Record<ItemType, string> = {
  screen: "Screen", component: "Component", theme: "Theme", api: "API",
};

const ALL_TYPES: ItemType[] = ["screen", "component", "theme", "api"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function stripMentionBlocks(text: string): string {
  return text.replace(/<!-- @[^>]+ -->\n[\s\S]*?<!-- end @[^>]+ -->\n\n?/g, "").trim();
}

// ─── Component ────────────────────────────────────────────────────────────────

export function LibraryPanel() {
  const { settings } = useAppStore();
  const { openComponent, openScreen, openTheme, openApi } = useProjectSettingsStore();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const project = settings.project || "default";
  const base = `projects/${project}`;

  // ─── Load via TanStack Query ───────────────────────────────────────────────

  const { data: items = [], isFetching } = useQuery({
    queryKey: projectKeys.library(project),
    queryFn: async (): Promise<LibraryItem[]> => {
      const all: LibraryItem[] = [];
      const dirMap: Array<{ type: ItemType; dir: string; isDir: boolean }> = [
        { type: "screen",    dir: `${base}/screens`,    isDir: true  },
        { type: "component", dir: `${base}/components`,  isDir: true  },
        { type: "theme",     dir: `${base}/themes`,      isDir: true  },
        { type: "api",       dir: `${base}/apis`,        isDir: false },
      ];
      for (const { type, dir, isDir } of dirMap) {
        try {
          const entries = await readDir(dir);
          for (const entry of entries) {
            if (isDir && !entry.is_dir) continue;
            if (!isDir && entry.is_dir) continue;
            const id = entry.name.replace(/\.json$/, "");
            let meta: ItemMeta | null = null;
            if (isDir) {
              try {
                const raw = await readFile(`${dir}/${entry.name}/meta.json`);
                meta = JSON.parse(raw) as ItemMeta;
              } catch { /* no meta yet */ }
            }
            all.push({ id, name: id, type, meta });
          }
        } catch { /* dir may not exist */ }
      }
      return all;
    },
    staleTime: 5_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: projectKeys.library(project) });

  // ─── Filtering & sorting ───────────────────────────────────────────────────

  const filtered = items
    .filter((item) => {
      if (typeFilter !== "all" && item.type !== typeFilter) return false;
      if (!search) return true;
      const q = search.toLowerCase();
      const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt).toLowerCase() : "";
      return item.name.toLowerCase().includes(q) || prompt.includes(q);
    })
    .sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name);
      if (sortKey === "type") return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
      // updated: items with meta first (newest), then alphabetical
      const ta = a.meta?.updatedAt ?? 0;
      const tb = b.meta?.updatedAt ?? 0;
      return tb - ta || a.name.localeCompare(b.name);
    });

  // ─── Actions ───────────────────────────────────────────────────────────────

  const openItem = (item: LibraryItem) => {
    if (item.type === "component") openComponent(item.id);
    else if (item.type === "screen") openScreen(item.id);
    else if (item.type === "theme") openTheme(item.id);
    else if (item.type === "api") openApi(item.id);
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!(await confirm(`Delete ${TYPE_LABELS[item.type].toLowerCase()} "${item.name}"?`))) return;
    const paths: Record<ItemType, string> = {
      component: `${base}/components/${item.id}`,
      theme:     `${base}/themes/${item.id}`,
      screen:    `${base}/screens/${item.id}`,
      api:       `${base}/apis/${item.id}.json`,
    };
    try {
      if (item.type === "api") {
        await deleteFile(paths.api);
      } else {
        await deleteDir(paths[item.type]);
      }
      if (expandedId === `${item.type}-${item.id}`) setExpandedId(null);
      invalidate();
    } catch (e) {
      notify.error("Delete failed", getErrorMessage(e));
    }
  };

  const handleDuplicate = async (item: LibraryItem) => {
    if (item.type === "api") {
      notify.error("Duplicate", "Duplicate is not supported for APIs");
      return;
    }
    const srcDir = `${base}/${item.type}s/${item.id}`;
    const destId = `${item.id}-copy`;
    const destDir = `${base}/${item.type}s/${destId}`;
    try {
      const copyDir = async (src: string, dest: string) => {
        await createDir(dest);
        const entries = await readDir(src);
        for (const entry of entries) {
          if (entry.is_dir) {
            await copyDir(`${src}/${entry.name}`, `${dest}/${entry.name}`);
          } else {
            const content = await readFile(`${src}/${entry.name}`);
            await writeFile(`${dest}/${entry.name}`, content);
          }
        }
      };
      await copyDir(srcDir, destDir);
      invalidate();
    } catch (e) {
      notify.error("Duplicate failed", getErrorMessage(e));
    }
  };

  const handleExport = async (item: LibraryItem) => {
    const paths: Record<ItemType, string> = {
      component: `${base}/components/${item.id}/component.tsx`,
      theme:     `${base}/themes/${item.id}/theme.css`,
      screen:    `${base}/screens/${item.id}/screen.tsx`,
      api:       `${base}/apis/${item.id}.json`,
    };
    const exts: Record<ItemType, string> = { component: "tsx", theme: "css", screen: "tsx", api: "json" };
    try {
      const content = await readFile(paths[item.type]);
      const dest = await save({
        filters: [{ name: item.type.toUpperCase(), extensions: [exts[item.type]] }],
        defaultPath: `${item.name}.${exts[item.type]}`,
      });
      if (!dest) return;
      await writeFile(dest, content);
      notify.success("Exported", dest);
    } catch (e) {
      notify.error("Export failed", getErrorMessage(e));
    }
  };

  const startRename = (item: LibraryItem) => {
    setRenamingId(`${item.type}-${item.id}`);
    setRenameValue(item.name);
  };

  const commitRename = async (item: LibraryItem) => {
    setRenamingId(null);
    const newId = renameValue.trim().toLowerCase().replace(/\s+/g, "-");
    if (!newId || newId === item.id) return;
    const paths: Record<ItemType, { from: string; to: string }> = {
      component: { from: `${base}/components/${item.id}`,       to: `${base}/components/${newId}` },
      theme:     { from: `${base}/themes/${item.id}`,           to: `${base}/themes/${newId}` },
      screen:    { from: `${base}/screens/${item.id}`,          to: `${base}/screens/${newId}` },
      api:       { from: `${base}/apis/${item.id}.json`,        to: `${base}/apis/${newId}.json` },
    };
    try {
      await renameFile(paths[item.type].from, paths[item.type].to);
      invalidate();
    } catch (e) {
      notify.error("Rename failed", getErrorMessage(e));
    }
  };

  const copyPrompt = async (item: LibraryItem) => {
    const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt) : "";
    if (!prompt) { notify.error("No prompt", "This item has no recorded prompt"); return; }
    await navigator.clipboard.writeText(prompt);
    notify.success("Copied", "Initial prompt copied to clipboard");
  };

  // ─── Counts ────────────────────────────────────────────────────────────────

  const counts = {
    all: items.length,
    screen:    items.filter((i) => i.type === "screen").length,
    component: items.filter((i) => i.type === "component").length,
    theme:     items.filter((i) => i.type === "theme").length,
    api:       items.filter((i) => i.type === "api").length,
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-background">

      {/* Toolbar */}
      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2 space-y-2">
        {/* Search */}
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or prompt…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-7 h-7 text-xs"
          />
        </div>

        {/* Type filter + sort */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {(["all", ...ALL_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={[
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors",
                  typeFilter === t
                    ? t === "all"
                      ? "bg-foreground/10 text-foreground font-medium"
                      : `${TYPE_BG[t as ItemType]} ${TYPE_COLORS[t as ItemType]} font-medium`
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                {t !== "all" && <span className={typeFilter === t ? TYPE_COLORS[t as ItemType] : ""}>{TYPE_ICONS[t as ItemType]}</span>}
                <span className="capitalize">{t === "all" ? "All" : TYPE_LABELS[t as ItemType]}</span>
                <span className="opacity-50 text-[10px]">{counts[t]}</span>
              </button>
            ))}
          </div>

          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="text-[11px] bg-transparent text-muted-foreground border-none outline-none cursor-pointer hover:text-foreground"
          >
            <option value="updated">Recent</option>
            <option value="name">Name</option>
            <option value="type">Type</option>
          </select>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="py-1">
          {isFetching && items.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">Loading…</p>
          )}
          {!isFetching && filtered.length === 0 && (
            <p className="text-center text-xs text-muted-foreground py-6">
              {search || typeFilter !== "all" ? "No items match" : "No items yet"}
            </p>
          )}

          {filtered.map((item) => {
            const rowKey = `${item.type}-${item.id}`;
            const isExpanded = expandedId === rowKey;
            const isRenaming = renamingId === rowKey;
            const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt) : "";

            return (
              <ContextMenu key={rowKey}>
                <ContextMenuTrigger asChild>
                  <div>
                    {/* Main row */}
                    <div
                      className={[
                        "group flex items-center gap-2 px-3 py-2 cursor-pointer select-none",
                        "hover:bg-accent/5 transition-colors",
                        isExpanded ? "bg-accent/5" : "",
                      ].join(" ")}
                      onClick={() => {
                        if (!isRenaming) setExpandedId(isExpanded ? null : rowKey);
                      }}
                      onDoubleClick={() => openItem(item)}
                    >
                      {/* Expand chevron */}
                      <span className="text-muted-foreground/40 w-3 shrink-0">
                        {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                      </span>

                      {/* Type icon */}
                      <span className={`shrink-0 ${TYPE_COLORS[item.type]}`}>
                        {TYPE_ICONS[item.type]}
                      </span>

                      {/* Name / rename input */}
                      {isRenaming ? (
                        <input
                          autoFocus
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitRename(item);
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onBlur={() => commitRename(item)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 min-w-0 text-xs bg-transparent border-b border-primary outline-none"
                        />
                      ) : (
                        <span className="flex-1 min-w-0 text-xs font-medium truncate text-foreground">
                          {item.name}
                        </span>
                      )}

                      {/* Meta: updated time */}
                      {item.meta ? (
                        <span className="shrink-0 text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
                          <Clock size={9} />
                          {relativeTime(item.meta.updatedAt)}
                        </span>
                      ) : (
                        <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${TYPE_BG[item.type]} ${TYPE_COLORS[item.type]}`}>
                          {TYPE_LABELS[item.type]}
                        </span>
                      )}
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mx-3 mb-2 rounded border border-border/50 bg-muted/20 text-[11px] overflow-hidden">
                        {/* Metadata row */}
                        <div className="flex items-center gap-3 px-3 py-2 border-b border-border/40 text-muted-foreground">
                          <span className={`flex items-center gap-1 ${TYPE_COLORS[item.type]}`}>
                            {TYPE_ICONS[item.type]}
                            <span className="font-medium">{TYPE_LABELS[item.type]}</span>
                          </span>
                          {item.meta ? (
                            <>
                              <span>Created {relativeTime(item.meta.createdAt)}</span>
                              <span>·</span>
                              <span>Updated {relativeTime(item.meta.updatedAt)}</span>
                              {item.meta.updates.length > 0 && (
                                <>
                                  <span>·</span>
                                  <span>{item.meta.updates.length + 1} generations</span>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="italic opacity-60">No metadata recorded yet</span>
                          )}
                        </div>

                        {/* Initial prompt */}
                        {prompt && (
                          <div className="px-3 py-2 border-b border-border/40">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Initial prompt</p>
                            <p className="text-foreground/80 leading-relaxed">{prompt}</p>
                          </div>
                        )}

                        {/* Update history */}
                        {item.meta && item.meta.updates.length > 0 && (
                          <div className="px-3 py-2">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Updates</p>
                            <div className="space-y-1.5">
                              {item.meta.updates.map((u, idx) => (
                                <div key={idx} className="flex gap-2">
                                  <span className="text-muted-foreground/50 shrink-0 tabular-nums">{relativeTime(u.at)}</span>
                                  <span className="text-foreground/70 leading-relaxed line-clamp-2">
                                    {stripMentionBlocks(u.prompt)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Quick actions */}
                        <div className="flex items-center gap-1 px-3 py-2 border-t border-border/40">
                          <button
                            onClick={() => openItem(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] bg-accent/10 hover:bg-accent/20 text-foreground/70 hover:text-foreground transition-colors"
                          >
                            Open in editor
                          </button>
                          <button
                            onClick={() => handleDuplicate(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Duplicate
                          </button>
                          <button
                            onClick={() => handleExport(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-accent/10 text-muted-foreground hover:text-foreground transition-colors"
                          >
                            Export
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors ml-auto"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </ContextMenuTrigger>

                <ContextMenuContent className="w-48">
                  <ContextMenuItem onClick={() => openItem(item)}>
                    Open in editor
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => startRename(item)}>
                    Rename
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleDuplicate(item)} disabled={item.type === "api"}>
                    Duplicate
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  {prompt && (
                    <ContextMenuItem onClick={() => copyPrompt(item)}>
                      Copy initial prompt
                    </ContextMenuItem>
                  )}
                  <ContextMenuItem onClick={() => handleExport(item)}>
                    Export file
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => handleDelete(item)}
                    className="text-destructive focus:text-destructive"
                  >
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer count */}
      {items.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center gap-1">
          <Plus size={9} />
          {filtered.length === items.length
            ? `${items.length} item${items.length !== 1 ? "s" : ""}`
            : `${filtered.length} of ${items.length}`}
        </div>
      )}
    </div>
  );
}
