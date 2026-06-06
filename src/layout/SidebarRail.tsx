import { useState, useEffect } from "react";
import { Plus, RefreshCw, LayoutGrid, FolderOpen, MessagesSquare } from "lucide-react";
import { SidebarFilesTab } from "@/components/sidebar/SidebarFilesTab";
import { SidebarChatsTab } from "@/components/sidebar/SidebarChatsTab";
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
import { createDir, writeFile, readFile, deleteDir, deleteFile, renameFile, getErrorMessage } from "@/lib/ipc";
import { addScreenToNavigation, removeScreenFromNavigation, renameScreenInNavigation, syncGeneratedRouter } from "@/lib/navigation";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { ProjectExplorer, SECTION_NAMES, SECTION_TREE_PATH } from "@/components/ProjectExplorer";
import type { SectionName } from "@/components/ProjectExplorer";

type SidebarTab = "project" | "files" | "chats";

export function SidebarRail() {
  const { settings } = useAppStore();
  const { setProjectSettings, openComponent, openScreen, openTheme, openWorkflow, openApi, openPlan } = useProjectSettingsStore();
  const [activeTab, setActiveTab] = useState<SidebarTab>("project");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newItemType, setNewItemType] = useState("screen");
  const [newItemName, setNewItemName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ section: SectionName; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const base = `projects/${settings.project}`;
  const generatedDir = getGeneratedDirPath(base);

  // Sync the sidebar tree when assets are created/changed outside the sidebar
  // (e.g. ThemesPanel "Save as", ComponentsPanel save-to-runner). Panels dispatch
  // `prototyper:tree-changed` with the affected section; invalidate that query so
  // ProjectExplorer's headless-tree rebuilds.
  useEffect(() => {
    const onTreeChanged = (event: Event) => {
      const section = (event as CustomEvent<{ section?: SectionName }>).detail?.section;
      if (section) {
        queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, SECTION_TREE_PATH[section]) });
      } else {
        for (const name of SECTION_NAMES) {
          queryClient.invalidateQueries({ queryKey: projectKeys.tree(settings.project, SECTION_TREE_PATH[name]) });
        }
      }
    };
    window.addEventListener("prototyper:tree-changed", onTreeChanged);
    return () => window.removeEventListener("prototyper:tree-changed", onTreeChanged);
  }, [settings.project]);

  // --- Navigation ---
  const handleSetDefaultTheme = (name: string) => {
    setProjectSettings({ stylePreset: name });
    notify.success("Default theme set", `"${name}" will be used for component and screen generation`);
  };

  const handleSelectAsset = (section: SectionName, name: string) => {
    if (section === "screens") openScreen(name);
    else if (section === "components") openComponent(name);
    else if (section === "themes") openTheme(name);
    else if (section === "workflows") openWorkflow(name);
    else if (section === "apis") openApi(name.replace(/\.json$/, ""));
    else if (section === "plans") openPlan(name.replace(/\.md$/, ""));
  };

  // --- Open new dialog prepopulated for a section type ---
  const openNewDialogFor = (type: string) => {
    setNewItemType(type);
    setNewItemName("");
    setShowNewDialog(true);
  };

  // Invalidate the tree query for a section. Wrapped so the query key uses
  // the section's filesystem path (currently all sections live at projects/{id}/{name}).
  const invalidateSection = (section: SectionName) => {
    queryClient.invalidateQueries({
      queryKey: projectKeys.tree(settings.project, SECTION_TREE_PATH[section]),
    });
  };

  // Map item type to the section name. All section names match their
  // filesystem paths (projects/{id}/{name}), so the same string drives both
  // the query key and the on-disk layout.
  const typeToSection: Record<string, SectionName> = {
    screen: "screens",
    component: "components",
    theme: "themes",
    workflow: "workflows",
    api: "apis",
    plan: "plans",
  };

  // --- Create ---
  const handleCreate = async () => {
    if (!newItemName.trim()) return;
    setCreating(true);
    const id = newItemName.toLowerCase().replace(/\s+/g, "-");
    try {
      switch (newItemType) {
        case "screen": {
          const fnName = id.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
          await createDir(`${base}/screens/${id}`);
          await writeFile(`${base}/screens/${id}/chat.json`, "[]");
          await writeFile(`${generatedDir}/src/pages/${id}.tsx`, `export default function ${fnName}() {\n  return <div>${newItemName}</div>;\n}\n`);
          await addScreenToNavigation(base, id);
          await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync navigation routes", getErrorMessage(e)); });
          break;
        }
        case "component": {
          const fnName = id.split("-").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
          await createDir(`${base}/components/${id}`);
          await writeFile(`${base}/components/${id}/prompt.json`, JSON.stringify({ name: newItemName, prompt: "", created: new Date().toISOString() }, null, 2));
          await createDir(`${generatedDir}/src/components/${id}`);
          await writeFile(`${generatedDir}/src/components/${id}/component.tsx`, `export default function ${fnName}() {\n  return <div>${newItemName}</div>;\n}\n`);
          await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync router", getErrorMessage(e)); });
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
        case "plan": {
          // Plans live at projects/{id}/plans/ as plain .md files
          // with YAML frontmatter (see src/lib/markdown/frontmatter.ts).
          const plansDir = `${base}/plans`;
          await createDir(plansDir);
          const today = new Date().toISOString().slice(0, 10);
          const initialContent = `---\ntitle: ${newItemName}\nstatus: draft\nupdated: ${today}\ntags:\n---\n\n# ${newItemName}\n\n`;
          await writeFile(`${plansDir}/${id}.md`, initialContent);
          break;
        }
      }
      const section = typeToSection[newItemType];
      invalidateSection(section);
      setShowNewDialog(false);
      setNewItemName("");
    } catch (e) {
      notify.error("Create failed", getErrorMessage(e));
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
      } else if (section === "plans") {
        await deleteFile(`${base}/plans/${name}.md`);
      } else {
        await deleteDir(`${base}/${section}/${name}`);
      }
      if (section === "screens") {
        await deleteFile(`${generatedDir}/src/pages/${name}.tsx`).catch(() => {});
        await removeScreenFromNavigation(base, name);
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync navigation routes", getErrorMessage(e)); });
      }
      if (section === "components") {
        await deleteDir(`${generatedDir}/src/components/${name}`).catch(() => {});
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync router", getErrorMessage(e)); });
      }
      invalidateSection(section);
    } catch (e) {
      notify.error("Delete failed", getErrorMessage(e));
    }
  };

  // --- Rename ---
  const startRename = (section: SectionName, name: string) => {
    setRenameTarget({ section, name });
    setRenameTo(name.replace(/\.json$/, "").replace(/\.md$/, ""));
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const { section, name } = renameTarget;
    const newId = renameTo.trim().toLowerCase().replace(/\s+/g, "-");
    try {
      if (section === "apis" || section === "workflows") {
        await renameFile(`${base}/${section}/${name}.json`, `${base}/${section}/${newId}.json`);
      } else if (section === "plans") {
        await renameFile(`${base}/plans/${name}.md`, `${base}/plans/${newId}.md`);
      } else {
        await renameFile(`${base}/${section}/${name}`, `${base}/${section}/${newId}`);
      }
      if (section === "screens") {
        await renameFile(`${generatedDir}/src/pages/${name}.tsx`, `${generatedDir}/src/pages/${newId}.tsx`).catch(() => {});
        await renameScreenInNavigation(base, name, newId);
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync navigation routes", getErrorMessage(e)); });
      }
      if (section === "components") {
        await renameFile(`${generatedDir}/src/components/${name}`, `${generatedDir}/src/components/${newId}`).catch(() => {});
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync router", getErrorMessage(e)); });
      }
      invalidateSection(section);
      setRenameTarget(null);
    } catch (e) {
      notify.error("Rename failed", getErrorMessage(e));
    }
  };

  // --- Duplicate ---
  const handleDuplicate = async (section: SectionName, name: string) => {
    const newId = `${name}-copy`;
    try {
      if (section === "screens") {
        await createDir(`${base}/screens/${newId}`);
        const code = await readFile(`${generatedDir}/src/pages/${name}.tsx`).catch(() => "");
        const chat = await readFile(`${base}/screens/${name}/chat.json`).catch(() => "[]");
        await writeFile(`${base}/screens/${newId}/chat.json`, chat);
        await writeFile(`${generatedDir}/src/pages/${newId}.tsx`, code);
        await addScreenToNavigation(base, newId);
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync navigation routes", getErrorMessage(e)); });
      } else if (section === "components") {
        await createDir(`${base}/components/${newId}`);
        const code = await readFile(`${generatedDir}/src/components/${name}/component.tsx`).catch(() => "");
        const meta = await readFile(`${base}/components/${name}/prompt.json`).catch(() => "{}");
        await writeFile(`${base}/components/${newId}/prompt.json`, meta);
        await createDir(`${generatedDir}/src/components/${newId}`);
        await writeFile(`${generatedDir}/src/components/${newId}/component.tsx`, code);
        await syncGeneratedRouter(base).catch((e) => { notify.error("Failed to sync router", getErrorMessage(e)); });
      } else if (section === "themes") {
        const dir = `${base}/themes/${newId}`;
        await createDir(dir);
        const css = await readFile(`${base}/themes/${name}/theme.css`).catch(() => "");
        const meta = await readFile(`${base}/themes/${name}/prompt.json`).catch(() => "{}");
        await writeFile(`${dir}/theme.css`, css);
        await writeFile(`${dir}/prompt.json`, meta);
      } else if (section === "plans") {
        const srcPath = `${base}/plans/${name}.md`;
        const dstPath = `${base}/plans/${newId}.md`;
        const content = await readFile(srcPath).catch(() => "");
        await writeFile(dstPath, content);
      }
      invalidateSection(section);
    } catch (e) {
      notify.error("Duplicate failed", getErrorMessage(e));
    }
  };

  // --- Refresh ---
  const refreshAll = () => {
    for (const section of SECTION_NAMES) {
      invalidateSection(section);
    }
  };


  const TABS: { id: SidebarTab; icon: React.ElementType; color: string; title: string }[] = [
    { id: "project", icon: LayoutGrid,      color: "text-violet-500", title: "Project" },
    { id: "files",   icon: FolderOpen,      color: "text-sky-500",    title: "Files" },
    { id: "chats",   icon: MessagesSquare,  color: "text-emerald-500", title: "Chats" },
  ];

  return (
    <div className="h-full flex flex-col bg-card border-r border-border">
      {/* Tab bar — icons only */}
      <div className="flex border-b border-border shrink-0">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              title={tab.title}
              className={`flex-1 flex items-center justify-center py-2 transition-colors border-b-2 ${
                active
                  ? `${tab.color} border-current`
                  : "text-muted-foreground border-transparent hover:text-foreground"
              }`}
            >
              <Icon size={15} />
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "files" && (
        <div className="flex-1 overflow-hidden">
          <SidebarFilesTab />
        </div>
      )}

      {activeTab === "chats" && (
        <div className="flex-1 overflow-hidden">
          <SidebarChatsTab />
        </div>
      )}

      {activeTab === "project" && (
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
      )}

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
                <SelectItem value="plan">Plan</SelectItem>
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
