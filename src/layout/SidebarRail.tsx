import { useState, useEffect, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  Plus,
  LayoutGrid,
  Box,
  Palette,
  GitBranch,
  Play,
  BookOpen,
  Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createDir, writeFile, readDir, type FileEntry } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

const views = [
  { id: "screens", label: "Screens", icon: LayoutGrid },
  { id: "components", label: "Components", icon: Box },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "apis", label: "APIs", icon: Terminal },
  { id: "runner", label: "Runner", icon: Play },
  { id: "library", label: "Library", icon: BookOpen },
];

interface SidebarRailProps {
  activeView: string;
  onViewChange: (view: string) => void;
  onNavigateToItem?: (type: string, name: string) => void;
}

export function SidebarRail({ activeView, onViewChange, onNavigateToItem }: SidebarRailProps) {
  const { settings } = useSettings();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newItemType, setNewItemType] = useState("screen");
  const [newItemName, setNewItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set(["screens", "components", "themes"]));
  const [tree, setTree] = useState<Record<string, FileEntry[]>>({});

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
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
        loadDir(name);
      }
      return next;
    });
  };

  const handleCreate = async () => {
    if (!newItemName.trim()) return;
    setCreating(true);
    const id = newItemName.toLowerCase().replace(/\s+/g, "-");
    const project = settings.project || "default";
    const base = `projects/${project}`;

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
          const dir = `${base}/apis`;
          await createDir(dir);
          await writeFile(`${dir}/${id}.json`, JSON.stringify({ name: newItemName, endpoints: [], created: new Date().toISOString() }, null, 2));
          break;
        }
      }
      setShowNewDialog(false);
      setNewItemName("");
      // Refresh relevant directory
      if (newItemType === "screen") loadDir("screens");
      if (newItemType === "component") loadDir("components");
      if (newItemType === "theme") loadDir("themes");
      if (newItemType === "api") loadDir("apis");
    } catch (e) {
      alert(`Create failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  const renderDir = (name: string, label: string, _viewType: string) => {
    const isExpanded = expanded.has(name);
    const entries = tree[name] || [];
    return (
      <div key={name}>
        <button
          className="w-full flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded transition-colors text-left"
          onClick={() => toggle(name)}
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {isExpanded ? <FolderOpen size={12} /> : <Folder size={12} />}
          <span className="font-medium">{label}</span>
          <span className="text-[10px] text-muted-foreground ml-auto">{entries.length}</span>
        </button>
        {isExpanded && (
          <div className="ml-4 space-y-0.5">
            {entries.length === 0 && (
              <div className="text-[10px] text-muted-foreground px-2">Empty</div>
            )}
            {entries.map((entry) => (
              <button
                key={entry.path}
                className="w-full flex items-center gap-1.5 px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted rounded cursor-pointer transition-colors text-left"
                onClick={() => {
                  if (entry.is_dir) {
                    toggle(entry.path);
                  } else if (onNavigateToItem) {
                    onNavigateToItem(name, entry.name);
                  }
                }}
              >
                {entry.is_dir ? <Folder size={10} /> : <FileCode size={10} />}
                <span className="truncate">{entry.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      {/* View Switcher */}
      <div className="flex-1 overflow-y-auto py-2">
        {views.map((view) => {
          const Icon = view.icon;
          const active = view.id === activeView;
          return (
            <button
              key={view.id}
              onClick={() => onViewChange(view.id)}
              className={[
                "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              ].join(" ")}
            >
              <Icon size={16} />
              {view.label}
            </button>
          );
        })}

        <div className="mx-3 my-2 h-px bg-border" />

        {/* Directory Browser */}
        <div className="px-2 space-y-0.5">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Project
          </div>
          {renderDir("screens", "Screens", "screens")}
          {renderDir("components", "Components", "components")}
          {renderDir("themes", "Themes", "themes")}
          {renderDir("workflows", "Workflows", "workflows")}
          {renderDir("apis", "APIs", "apis")}
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

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={newItemType} onValueChange={setNewItemType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
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
            />
            <Button className="w-full" onClick={handleCreate} disabled={creating || !newItemName.trim()}>
              {creating ? "Creating…" : "Create"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
