import { useState } from "react";
import { Search, ChevronDown, Plus, LayoutGrid, LayoutList } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { readDir, readFile, writeFile, deleteDir, deleteFile, renameFile, createDir, listWorkflows, getErrorMessage } from "@/lib/ipc";
import { save, confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { projectKeys } from "@/lib/queryKeys";
import { ListRow, GalleryCard } from "@/panels/library/LibraryItems";
import {
  ALL_TYPES, TYPE_LABELS, TYPE_BG, TYPE_COLORS, SORT_LABELS,
  extractPalette, stripMentionBlocks,
} from "@/panels/library/types";
import type { LibraryItem, ItemType, SortKey, ViewMode, RowActions } from "@/panels/library/types";

export function LibraryPanel() {
  const { settings } = useAppStore();
  const { openCreate, openApi, openWorkflow } = useProjectSettingsStore();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<ItemType | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const project = settings.project || "default";
  const base = `projects/${project}`;

  // ─── Data ─────────────────────────────────────────────────────────────────

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
      // Workflows are stored via Rust commands (not plain file dirs)
      try {
        const workflowEntries = await listWorkflows(project);
        for (const entry of workflowEntries) {
          const id = entry.name.replace(/\.json$/, "");
          all.push({ id, name: id, type: "workflow", meta: null });
        }
      } catch { /* no workflows yet */ }
      for (const { type, dir, isDir } of dirMap) {
        try {
          const entries = await readDir(dir);
          for (const entry of entries) {
            if (isDir && !entry.is_dir) continue;
            if (!isDir && entry.is_dir) continue;
            const id = entry.name.replace(/\.json$/, "");
            let meta = null;
            let palette: string[] | undefined;
            if (isDir) {
              try { meta = JSON.parse(await readFile(`${dir}/${entry.name}/meta.json`)); } catch { /* none yet */ }
              if (type === "theme") {
                try { palette = extractPalette(await readFile(`${dir}/${entry.name}/theme.css`)); } catch { /* none */ }
              }
            }
            all.push({ id, name: id, type, meta, ...(palette ? { palette } : {}) });
          }
        } catch { /* dir may not exist */ }
      }
      return all;
    },
    staleTime: 5_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: projectKeys.library(project) });

  // ─── Filtering & sorting ──────────────────────────────────────────────────

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
      return (b.meta?.updatedAt ?? 0) - (a.meta?.updatedAt ?? 0) || a.name.localeCompare(b.name);
    });

  // ─── Actions ──────────────────────────────────────────────────────────────

  const openItem = (item: LibraryItem) => {
    if (item.type === "component") openCreate("components", item.id);
    else if (item.type === "screen") openCreate("screens", item.id);
    else if (item.type === "theme") openCreate("themes", item.id);
    else if (item.type === "api") openApi(item.id);
    else if (item.type === "workflow") openWorkflow(item.id);
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!(await confirm(`Delete ${TYPE_LABELS[item.type].toLowerCase()} "${item.name}"?`))) return;
    const paths: Record<ItemType, string> = {
      component: `${base}/components/${item.id}`,
      theme:     `${base}/themes/${item.id}`,
      screen:    `${base}/screens/${item.id}`,
      api:       `${base}/apis/${item.id}.json`,
      workflow:  `projects/${project}/workflows/${item.id}.json`,
    };
    try {
      if (item.type === "api" || item.type === "workflow") await deleteFile(paths[item.type]);
      else await deleteDir(paths[item.type]);
      if (expandedId === `${item.type}-${item.id}`) setExpandedId(null);
      invalidate();
    } catch (e) { notify.error("Delete failed", getErrorMessage(e)); }
  };

  const handleDuplicate = async (item: LibraryItem) => {
    if (item.type === "api" || item.type === "workflow") { notify.error("Duplicate", "Not supported for this type"); return; }
    const srcDir = `${base}/${item.type}s/${item.id}`;
    const destDir = `${base}/${item.type}s/${item.id}-copy`;
    try {
      const copyDir = async (src: string, dest: string) => {
        await createDir(dest);
        const entries = await readDir(src);
        for (const entry of entries) {
          if (entry.is_dir) await copyDir(`${src}/${entry.name}`, `${dest}/${entry.name}`);
          else await writeFile(`${dest}/${entry.name}`, await readFile(`${src}/${entry.name}`));
        }
      };
      await copyDir(srcDir, destDir);
      invalidate();
    } catch (e) { notify.error("Duplicate failed", getErrorMessage(e)); }
  };

  const handleExport = async (item: LibraryItem) => {
    const paths: Record<ItemType, string> = {
      component: `${base}/components/${item.id}/component.tsx`,
      theme:     `${base}/themes/${item.id}/theme.css`,
      screen:    `${base}/screens/${item.id}/screen.tsx`,
      api:       `${base}/apis/${item.id}.json`,
      workflow:  `projects/${project}/workflows/${item.id}.json`,
    };
    const exts: Record<ItemType, string> = { component: "tsx", theme: "css", screen: "tsx", api: "json", workflow: "json" };
    try {
      const content = await readFile(paths[item.type]);
      const dest = await save({ filters: [{ name: item.type.toUpperCase(), extensions: [exts[item.type]] }], defaultPath: `${item.name}.${exts[item.type]}` });
      if (!dest) return;
      await writeFile(dest, content);
      notify.success("Exported", dest);
    } catch (e) { notify.error("Export failed", getErrorMessage(e)); }
  };

  const startRename = (item: LibraryItem) => { setRenamingId(`${item.type}-${item.id}`); setRenameValue(item.name); };

  const commitRename = async (item: LibraryItem) => {
    setRenamingId(null);
    const newId = renameValue.trim().toLowerCase().replace(/\s+/g, "-");
    if (!newId || newId === item.id) return;
    const paths: Record<ItemType, { from: string; to: string }> = {
      component: { from: `${base}/components/${item.id}`, to: `${base}/components/${newId}` },
      theme:     { from: `${base}/themes/${item.id}`,     to: `${base}/themes/${newId}` },
      screen:    { from: `${base}/screens/${item.id}`,    to: `${base}/screens/${newId}` },
      api:       { from: `${base}/apis/${item.id}.json`,  to: `${base}/apis/${newId}.json` },
      workflow:  { from: `projects/${project}/workflows/${item.id}.json`, to: `projects/${project}/workflows/${newId}.json` },
    };
    try { await renameFile(paths[item.type].from, paths[item.type].to); invalidate(); }
    catch (e) { notify.error("Rename failed", getErrorMessage(e)); }
  };

  const copyPrompt = async (item: LibraryItem) => {
    const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt) : "";
    if (!prompt) { notify.error("No prompt", "This item has no recorded prompt"); return; }
    await navigator.clipboard.writeText(prompt);
    notify.success("Copied", "Initial prompt copied to clipboard");
  };

  // ─── Shared actions object passed to row components ───────────────────────

  const rowActions: RowActions = {
    openItem, startRename, commitRename, copyPrompt,
    handleDuplicate, handleExport, handleDelete,
    expandedId, setExpandedId, renamingId, renameValue, setRenameValue,
  };

  // ─── Counts ───────────────────────────────────────────────────────────────

  const counts: Record<ItemType | "all", number> = {
    all: items.length,
    screen:    items.filter((i) => i.type === "screen").length,
    component: items.filter((i) => i.type === "component").length,
    theme:     items.filter((i) => i.type === "theme").length,
    api:       items.filter((i) => i.type === "api").length,
    workflow:  items.filter((i) => i.type === "workflow").length,
  };

  const isEmpty = !isFetching && filtered.length === 0;

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-background">

      {/* Toolbar */}
      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2 space-y-2">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input placeholder="Search by name or prompt…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-7 h-7 text-xs" />
        </div>

        <div className="flex items-center justify-between gap-2">
          {/* Type filter pills */}
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
            {(["all", ...ALL_TYPES] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={[
                  "flex items-center gap-1 px-2 py-0.5 rounded text-[11px] transition-colors shrink-0",
                  typeFilter === t
                    ? t === "all" ? "bg-foreground/10 text-foreground font-medium" : `${TYPE_BG[t as ItemType]} ${TYPE_COLORS[t as ItemType]} font-medium`
                    : "text-muted-foreground hover:text-foreground",
                ].join(" ")}
              >
                <span className="capitalize">{t === "all" ? "All" : TYPE_LABELS[t as ItemType]}</span>
                <span className="opacity-50 text-[10px]">{counts[t]}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {/* Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px] text-muted-foreground gap-1">
                  {SORT_LABELS[sortKey]}<ChevronDown size={9} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-28">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => setSortKey(k)} className={sortKey === k ? "font-medium text-foreground" : ""}>
                    {SORT_LABELS[k]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View toggle */}
            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground" onClick={() => setViewMode(viewMode === "list" ? "gallery" : "list")} title={viewMode === "list" ? "Gallery view" : "List view"}>
              {viewMode === "list" ? <LayoutGrid size={12} /> : <LayoutList size={12} />}
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className={viewMode === "gallery" ? "p-3 grid grid-cols-2 gap-2" : "py-1"}>
          {isFetching && items.length === 0 && <p className={`text-center text-xs text-muted-foreground py-6 ${viewMode === "gallery" ? "col-span-2" : ""}`}>Loading…</p>}
          {isEmpty && <p className={`text-center text-xs text-muted-foreground py-6 ${viewMode === "gallery" ? "col-span-2" : ""}`}>{search || typeFilter !== "all" ? "No items match" : "No items yet"}</p>}
          {viewMode === "list"
            ? filtered.map((item) => <ListRow key={`${item.type}-${item.id}`} item={item} actions={rowActions} />)
            : filtered.map((item) => <GalleryCard key={`${item.type}-${item.id}`} item={item} actions={rowActions} />)
          }
        </div>
      </ScrollArea>

      {/* Footer */}
      {items.length > 0 && (
        <div className="shrink-0 px-3 py-2 border-t border-border text-[10px] text-muted-foreground flex items-center gap-1">
          <Plus size={9} />
          {filtered.length === items.length ? `${items.length} item${items.length !== 1 ? "s" : ""}` : `${filtered.length} of ${items.length}`}
        </div>
      )}
    </div>
  );
}
