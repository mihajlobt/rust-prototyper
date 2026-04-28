import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createDir, writeFile, readFile, deleteDir, deleteFile, renameFile } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { ProjectExplorer, SECTION_NAMES } from "@/components/ProjectExplorer";
import type { SectionName } from "@/components/ProjectExplorer";

export function SidebarRail() {
  const { settings } = useAppStore();
  const { setPs, openComponent, openScreen, openTheme, openWorkflow, openApi } = useProjectSettingsStore();
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newItemType, setNewItemType] = useState("screen");
  const [newItemName, setNewItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ section: SectionName; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const base = `projects/${settings.project}`;

  // --- Navigation ---
  const handleSetDefaultTheme = (name: string) => {
    setPs({ stylePreset: name });
    notify.success("Default theme set", `"${name}" will be used for component and screen generation`);
  };

  const handleSelectAsset = (section: SectionName, name: string) => {
    if (section === "screens") openScreen(name);
    else if (section === "components") openComponent(name);
    else if (section === "themes") openTheme(name);
    else if (section === "workflows") openWorkflow(name);
    else if (section === "apis") openApi(name.replace(/\.json$/, ""));
  };

  // --- Open new dialog prepopulated for a section type ---
  const openNewDialogFor = (type: string) => {
    setNewItemType(type);
    setNewItemName("");
    setShowNewDialog(true);
  };

  // Map item type to the section name used in query keys
  const typeToSection: Record<string, string> = {
    screen: "screens",
    component: "components",
    theme: "themes",
    workflow: "workflows",
    api: "apis",
  };

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
        case "workflow": {
          await createDir(`${base}/workflows`);
          await writeFile(`${base}/workflows/${id}.json`, JSON.stringify({ name: newItemName, nodes: [], created: new Date().toISOString() }, null, 2));
          break;
        }
        case "api": {
          await createDir(`${base}/apis`);
          await writeFile(`${base}/apis/${id}.json`, JSON.stringify({ name: newItemName, endpoints: [], created: new Date().toISOString() }, null, 2));
          break;
        }
      }
      const section = typeToSection[newItemType];
      await queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, section) });
      setShowNewDialog(false);
      setNewItemName("");
    } catch (e) {
      notify.error("Create failed", e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  // --- Delete ---
  const handleDelete = async (section: SectionName, name: string) => {
    if (!(await confirm(`Delete "${name}"?`))) return;
    try {
      if (section === "apis" || section === "workflows") {
        await deleteFile(`${base}/${section}/${name}.json`);
      } else {
        await deleteDir(`${base}/${section}/${name}`);
      }
      await queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, section) });
    } catch (e) {
      notify.error("Delete failed", e instanceof Error ? e.message : String(e));
    }
  };

  // --- Rename ---
  const startRename = (section: SectionName, name: string) => {
    setRenameTarget({ section, name });
    setRenameTo(name.replace(/\.json$/, ""));
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const { section, name } = renameTarget;
    const newId = renameTo.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      if (section === "apis" || section === "workflows") {
        await renameFile(`${base}/${section}/${name}.json`, `${base}/${section}/${newId}.json`);
      } else {
        await renameFile(`${base}/${section}/${name}`, `${base}/${section}/${newId}`);
      }
      await queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, section) });
      setRenameTarget(null);
    } catch (e) {
      notify.error("Rename failed", e instanceof Error ? e.message : String(e));
    }
  };

  // --- Duplicate ---
  const handleDuplicate = async (section: SectionName, name: string) => {
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
      await queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, section) });
    } catch (e) {
      notify.error("Duplicate failed", e instanceof Error ? e.message : String(e));
    }
  };

  // --- Refresh ---
  const refreshAll = () => {
    for (const section of SECTION_NAMES) {
      queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, section) });
    }
  };


  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      <ContextMenu>
        <ContextMenuTrigger             asChild>
          <ScrollArea className="flex-1 overflow-hidden">
            <div className="py-2">
              <div className="px-2 space-y-0.5">
                <div className="flex items-center justify-between px-2 mb-1">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Project
                  </span>
                  <button
                    onClick={refreshAll}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw size={10} />
                  </button>
                </div>
                <ProjectExplorer
                  onSelectAsset={handleSelectAsset}
                  onSetDefaultTheme={handleSetDefaultTheme}
                  onRename={startRename}
                  onDelete={handleDelete}
                  onDuplicate={handleDuplicate}
                  onNewItem={openNewDialogFor}
                  onRefresh={refreshAll}
                />
              </div>
            </div>
          </ScrollArea>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => openNewDialogFor(newItemType)}>
            <Plus size={12} className="mr-2" />New…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={refreshAll}>
            <RefreshCw size={12} className="mr-2" />Refresh
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* New item dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Select value={newItemType} onValueChange={setNewItemType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent position="popper" side="bottom">
                <SelectItem value="screen">Screen</SelectItem>
                <SelectItem value="component">Component</SelectItem>
                <SelectItem value="theme">Theme</SelectItem>
                <SelectItem value="workflow">Workflow</SelectItem>
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
            <DialogTitle>Rename &ldquo;{renameTarget?.name}&rdquo;</DialogTitle>
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
