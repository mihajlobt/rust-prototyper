import { useState, useEffect, useCallback } from "react";
import {
  Folder, FolderOpen, FileCode, ChevronRight, ChevronDown, Plus, RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { createDir, writeFile, readDir, readFile, deleteDir, deleteFile, renameFile, type FileEntry } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

interface SidebarRailProps {
  onNavigateToItem?: (type: string, name: string) => void;
  activeView?: string;
  activeItem?: string;
}

const DIR_LABELS: Record<string, string> = {
  screens: "Screens",
  components: "Components",
  themes: "Themes",
  workflows: "Workflows",
  apis: "APIs",
};

export function SidebarRail({ onNavigateToItem, activeView, activeItem }: SidebarRailProps) {
  const { settings, setSettings } = useSettings();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newItemType, setNewItemType] = useState("screen");
  const [newItemName, setNewItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["screens", "components", "themes"]));
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});
  const [renameTarget, setRenameTarget] = useState<{ section: string; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const loadDir = useCallback(async (name: string) => {
    try {
      const entries = await readDir(`projects/${settings.project}/${name}`);
      setTree((prev) => ({ ...prev, [name]: entries }));
    } catch {
      setTree((prev) => ({ ...prev, [name]: [] }));
    }
  }, [settings.project]);

  useEffect(() => {
    loadDir("screens");
    loadDir("components");
    loadDir("themes");
    loadDir("workflows");
    loadDir("apis");
  }, [loadDir]);

  const toggle = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else { next.add(name); loadDir(name); }
      return next;
    });
  };

  const base = `projects/${settings.project}`;

  // --- Create ---
  const handleCreate = async () => {
    if (!newItemName.trim()) return;
    setCreating(true);
    const id = newItemName.toLowerCase().replace(/\s+/g, "-");
    try {
      switch (newItemType) {
        case "screen": {
          const dir = `${base}/screens/${id}`;
          await createDir(dir);
          await writeFile(`${dir}/screen.tsx`, `// ${newItemName}\nexport default function ${id.replace(/-/g, "_")}() {\n  return <div>${newItemName}</div>;\n}\n`);
          await writeFile(`${dir}/chat.json`, "[]");
          break;
        }
        case "component": {
          const dir = `${base}/components/${id}`;
          await createDir(dir);
          await writeFile(`${dir}/component.tsx`, `// ${newItemName}\nexport default function ${id.replace(/-/g, "_")}() {\n  return <div>${newItemName}</div>;\n}\n`);
          await writeFile(`${dir}/prompt.json`, JSON.stringify({ name: newItemName, prompt: "", created: new Date().toISOString() }, null, 2));
          break;
        }
        case "theme": {
          const dir = `${base}/themes/${id}`;
          await createDir(dir);
          await writeFile(`${dir}/theme.css`, `/* ${newItemName} */\n`);
          await writeFile(`${dir}/prompt.json`, JSON.stringify({ name: newItemName, prompt: "", created: new Date().toISOString() }, null, 2));
          break;
        }
        case "api": {
          await createDir(`${base}/apis`);
          await writeFile(`${base}/apis/${id}.json`, JSON.stringify({ name: newItemName, endpoints: [], created: new Date().toISOString() }, null, 2));
          break;
        }
      }
      setShowNewDialog(false);
      setNewItemName("");
      const sectionMap: Record<string, string> = { screen: "screens", component: "components", theme: "themes", api: "apis" };
      loadDir(sectionMap[newItemType]);
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  // --- Delete ---
  const handleDelete = async (section: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return;
    try {
      if (section === "apis") {
        await deleteFile(`${base}/apis/${name}`);
      } else {
        await deleteDir(`${base}/${section}/${name}`);
      }
      loadDir(section);
    } catch (e) {
      alert(`Delete failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // --- Rename ---
  const startRename = (section: string, name: string) => {
    setRenameTarget({ section, name });
    setRenameTo(name.replace(/\.json$/, ""));
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const { section, name } = renameTarget;
    const newId = renameTo.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      if (section === "apis") {
        await renameFile(`${base}/apis/${name}`, `${base}/apis/${newId}.json`);
      } else {
        await renameFile(`${base}/${section}/${name}`, `${base}/${section}/${newId}`);
      }
      loadDir(section);
    } catch (e) {
      alert(`Rename failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRenameTarget(null);
    }
  };

  // --- Duplicate ---
  const handleDuplicate = async (section: string, name: string) => {
    const newId = `${name}-copy`;
    try {
      if (section === "screens") {
        const dir = `${base}/screens/${newId}`;
        await createDir(dir);
        const code = await readFile(`${base}/screens/${name}/screen.tsx`).catch(() => "");
        const chat = await readFile(`${base}/screens/${name}/chat.json`).catch(() => "[]");
        await writeFile(`${dir}/screen.tsx`, code);
        await writeFile(`${dir}/chat.json`, chat);
      } else if (section === "components") {
        const dir = `${base}/components/${newId}`;
        await createDir(dir);
        const code = await readFile(`${base}/components/${name}/component.tsx`).catch(() => "");
        const meta = await readFile(`${base}/components/${name}/prompt.json`).catch(() => "{}");
        await writeFile(`${dir}/component.tsx`, code);
        await writeFile(`${dir}/prompt.json`, meta);
      } else if (section === "themes") {
        const dir = `${base}/themes/${newId}`;
        await createDir(dir);
        const css = await readFile(`${base}/themes/${name}/theme.css`).catch(() => "");
        const meta = await readFile(`${base}/themes/${name}/prompt.json`).catch(() => "{}");
        await writeFile(`${dir}/theme.css`, css);
        await writeFile(`${dir}/prompt.json`, meta);
      }
      loadDir(section);
    } catch (e) {
      alert(`Duplicate failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // --- Section new shortcut ---
  const openNewFor = (type: string) => {
    setNewItemType(type);
    setNewItemName("");
    setShowNewDialog(true);
  };

  const sectionType: Record<string, string> = {
    screens: "screen", components: "component", themes: "theme",
    workflows: "workflow", apis: "api",
  };

  const renderDir = (section: string) => {
    const label = DIR_LABELS[section];
    const isExpanded = expanded.has(section);
    const entries = tree[section] || [];

    return (
      <div key={section}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <button
              className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors text-left"
              onClick={() => toggle(section)}
            >
              {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
              <span className="font-medium">{label}</span>
              <span className="text-[10px] text-muted-foreground ml-auto">{entries.length}</span>
            </button>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => openNewFor(sectionType[section])}>
              New {sectionType[section]}…
            </ContextMenuItem>
            <ContextMenuItem onClick={() => loadDir(section)}>
              <RefreshCw size={12} className="mr-2" /> Refresh
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>

        {isExpanded && (
          <div className="ml-4 space-y-0.5">
            {entries.length === 0 && (
              <div className="text-[10px] text-muted-foreground px-2">Empty</div>
            )}
            {entries.map((entry) => {
              const isActive = activeView === section && (activeItem === entry.name || activeItem === entry.name.replace(/\.json$/, ""));
              return (
              <ContextMenu key={entry.path}>
                <ContextMenuTrigger asChild>
                  <button
                    className={[
                      "w-full flex items-center gap-1.5 px-2 py-0.5 text-xs rounded cursor-pointer transition-colors text-left",
                      isActive
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted",
                    ].join(" ")}
                    onClick={() => onNavigateToItem?.(section, entry.name)}
                  >
                    {entry.is_dir ? <Folder size={10} /> : <FileCode size={10} />}
                    <span className="truncate">{entry.name}</span>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onNavigateToItem?.(section, entry.name)}>
                    Open
                  </ContextMenuItem>
                  {(section === "screens" || section === "components" || section === "themes") && (
                    <ContextMenuItem onClick={() => handleDuplicate(section, entry.name)}>
                      Duplicate
                    </ContextMenuItem>
                  )}
                  {section === "themes" && (
                    <ContextMenuItem onClick={() => setSettings({ stylePreset: entry.name })}>
                      Set as default theme
                    </ContextMenuItem>
                  )}
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => startRename(section, entry.name)}>
                    Rename…
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleDelete(section, entry.name)}
                  >
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      <div className="flex-1 overflow-y-auto py-2">
        <div className="px-2 space-y-0.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Project
          </div>
          {renderDir("screens")}
          {renderDir("components")}
          {renderDir("themes")}
          {renderDir("workflows")}
          {renderDir("apis")}
        </div>
      </div>

      <div className="p-2 border-t border-border">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
          onClick={() => setShowNewDialog(true)}
        >
          <Plus size={16} />
          New Item
        </button>
      </div>

      {/* New item dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={newItemType} onValueChange={setNewItemType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="screen">Screen</SelectItem>
                <SelectItem value="component">Component</SelectItem>
                <SelectItem value="theme">Theme</SelectItem>
                <SelectItem value="api">API</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={newItemName}
              onChange={(e) => setNewItemName(e.target.value)}
              placeholder="Name..."
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
            />
            <Button className="w-full" onClick={handleCreate} disabled={creating || !newItemName.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename "{renameTarget?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder="New name..."
              onKeyDown={(e) => e.key === "Enter" && handleRename()}
              autoFocus
            />
            <Button className="w-full" onClick={handleRename} disabled={!renameTo.trim()}>
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
