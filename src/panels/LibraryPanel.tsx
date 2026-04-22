import { useState, useEffect, useCallback } from "react";
import { Box, Palette, LayoutGrid, Terminal, Search, Trash2, Copy, Download, Edit2, ExternalLink } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { readDir, readFile, writeFile, deleteDir, createDir, renameFile } from "@/lib/ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { useSettings } from "@/hooks/useSettings";

interface LibraryItem {
  id: string;
  name: string;
  type: "component" | "theme" | "screen" | "api";
  description?: string;
}

interface LibraryPanelProps {
  onNavigateToItem?: (type: string, name: string) => void;
}

export function LibraryPanel({ onNavigateToItem }: LibraryPanelProps) {
  const { settings } = useSettings();
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("all");
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const all: LibraryItem[] = [];
    const project = settings.project || "default";
    const base = `./projects/${project}`;

    const dirs: Record<string, string> = {
      component: `${base}/components`,
      theme: `${base}/themes`,
      screen: `${base}/screens`,
      api: `${base}/apis`,
    };

    for (const [type, dir] of Object.entries(dirs)) {
      try {
        const entries = await readDir(dir);
        for (const entry of entries) {
          if (!entry.is_dir) continue;
          let description = "";
          try {
            const meta = await readFile(`${entry.path}/prompt.json`);
            const parsed = JSON.parse(meta);
            description = parsed.prompt || "";
          } catch {
            // ignore
          }
          all.push({
            id: entry.name,
            name: entry.name,
            type: type as LibraryItem["type"],
            description,
          });
        }
      } catch {
        // directory may not exist yet
      }
    }

    setItems(all);
    setLoading(false);
  }, [settings.project]);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const filtered = items.filter((item) => {
    const matchesSearch =
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description?.toLowerCase() || "").includes(search.toLowerCase());
    const matchesTab = activeTab === "all" || item.type === activeTab;
    return matchesSearch && matchesTab;
  });

  const typeIcons: Record<string, React.ReactNode> = {
    component: <Box size={14} />,
    theme: <Palette size={14} />,
    screen: <LayoutGrid size={14} />,
    api: <Terminal size={14} />,
  };

  const typeGradients: Record<string, string> = {
    component: "from-blue-500 to-purple-500",
    theme: "from-pink-500 to-orange-500",
    screen: "from-green-500 to-teal-500",
    api: "from-gray-500 to-slate-500",
  };

  const handleDelete = async (item: LibraryItem) => {
    if (!confirm(`Delete ${item.type} "${item.name}"?`)) return;
    const project = settings.project || "default";
    const base = `./projects/${project}`;
    const paths: Record<string, string> = {
      component: `${base}/components/${item.id}`,
      theme: `${base}/themes/${item.id}`,
      screen: `${base}/screens/${item.id}`,
      api: `${base}/apis/${item.id}`,
    };
    try {
      await deleteDir(paths[item.type]);
      await loadItems();
    } catch {
      // ignore
    }
  };

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  const handleRename = async (item: LibraryItem) => {
    if (!editName.trim() || editName === item.name) {
      setEditingId(null);
      return;
    }
    const project = settings.project || "default";
    const base = `./projects/${project}`;
    const paths: Record<string, { from: string; to: string }> = {
      component: { from: `${base}/components/${item.id}`, to: `${base}/components/${editName.toLowerCase().replace(/\s+/g, "-")}` },
      theme: { from: `${base}/themes/${item.id}`, to: `${base}/themes/${editName.toLowerCase().replace(/\s+/g, "-")}` },
      screen: { from: `${base}/screens/${item.id}`, to: `${base}/screens/${editName.toLowerCase().replace(/\s+/g, "-")}` },
      api: { from: `${base}/apis/${item.id}.json`, to: `${base}/apis/${editName.toLowerCase().replace(/\s+/g, "-")}.json` },
    };
    try {
      await renameFile(paths[item.type].from, paths[item.type].to);
      setEditingId(null);
      await loadItems();
    } catch {
      // ignore
    }
  };

  const handleDuplicate = async (item: LibraryItem) => {
    const project = settings.project || "default";
    const base = `./projects/${project}`;
    const newId = `${item.id}-copy`;
    const paths: Record<string, { from: string; to: string }> = {
      component: { from: `${base}/components/${item.id}`, to: `${base}/components/${newId}` },
      theme: { from: `${base}/themes/${item.id}`, to: `${base}/themes/${newId}` },
      screen: { from: `${base}/screens/${item.id}`, to: `${base}/screens/${newId}` },
      api: { from: `${base}/apis/${item.id}.json`, to: `${base}/apis/${newId}.json` },
    };
    try {
      if (item.type === "api") {
        const content = await readFile(paths[item.type].from);
        await writeFile(paths[item.type].to, content);
      } else {
        // Recursive directory copy
        const copyDir = async (src: string, dest: string) => {
          await createDir(dest);
          const entries = await readDir(src);
          for (const entry of entries) {
            const srcPath = `${src}/${entry.name}`;
            const destPath = `${dest}/${entry.name}`;
            if (entry.is_dir) {
              await copyDir(srcPath, destPath);
            } else {
              const content = await readFile(srcPath);
              await writeFile(destPath, content);
            }
          }
        };
        await copyDir(paths[item.type].from, paths[item.type].to);
      }
      await loadItems();
    } catch {
      // ignore
    }
  };

  const handleExport = async (item: LibraryItem) => {
    const project = settings.project || "default";
    const base = `./projects/${project}`;
    const paths: Record<string, string> = {
      component: `${base}/components/${item.id}/component.tsx`,
      theme: `${base}/themes/${item.id}/theme.css`,
      screen: `${base}/screens/${item.id}/screen.tsx`,
      api: `${base}/apis/${item.id}.json`,
    };
    try {
      const content = await readFile(paths[item.type]);
      const outputPath = await save({
        filters: [{ name: item.type === "api" ? "JSON" : item.type === "theme" ? "CSS" : "TSX", extensions: [item.type === "api" ? "json" : item.type === "theme" ? "css" : "tsx"] }],
        defaultPath: `${item.name}.${item.type === "api" ? "json" : item.type === "theme" ? "css" : "tsx"}`,
      });
      if (!outputPath) return;
      await writeFile(outputPath, content);
      alert(`Exported to ${outputPath}`);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search library..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={loadItems} disabled={loading}>
          {loading ? "…" : "Refresh"}
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="all" className="gap-1.5 text-xs"><LayoutGrid size={12} />All</TabsTrigger>
          <TabsTrigger value="component" className="gap-1.5 text-xs"><Box size={12} />Components</TabsTrigger>
          <TabsTrigger value="theme" className="gap-1.5 text-xs"><Palette size={12} />Themes</TabsTrigger>
          <TabsTrigger value="screen" className="gap-1.5 text-xs"><LayoutGrid size={12} />Screens</TabsTrigger>
          <TabsTrigger value="api" className="gap-1.5 text-xs"><Terminal size={12} />APIs</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="flex-1 overflow-hidden mt-4">
          <ScrollArea className="h-full">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {filtered.map((item) => (
                <div
                  key={`${item.type}-${item.id}`}
                  className="rounded-lg border border-border bg-card hover:border-primary/50 transition-colors overflow-hidden"
                >
                  <div className={`w-full h-2 bg-gradient-to-r ${typeGradients[item.type]}`} />
                  <div className="p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-muted-foreground">{typeIcons[item.type]}</span>
                    {editingId === `${item.type}-${item.id}` ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-6 text-xs"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(item);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                        onBlur={() => handleRename(item)}
                        autoFocus
                      />
                    ) : (
                      <span className="font-medium text-sm">{item.name}</span>
                    )}
                    <Badge variant="secondary" className="text-[10px] h-4 ml-auto capitalize">
                      {item.type}
                    </Badge>
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{item.description}</p>
                  )}
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" title="Open in editor" onClick={() => onNavigateToItem?.(item.type, item.id)}>
                      <ExternalLink size={12} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditingId(`${item.type}-${item.id}`); setEditName(item.name); }}>
                      <Edit2 size={12} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDuplicate(item)}>
                      <Copy size={12} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleExport(item)}>
                      <Download size={12} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => handleDelete(item)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                  </div>
                </div>
              ))}
            </div>
            {filtered.length === 0 && (
              <div className="text-center text-sm text-muted-foreground py-8">
                {loading ? "Loading…" : "No items match your search"}
              </div>
            )}
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
