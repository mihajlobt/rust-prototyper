import { useState, useEffect, useCallback, useMemo } from "react";
import { Plus as PlusIcon, FolderPlus, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  readDir, writeFile, createDir, deleteFile,
  deleteDir, renameFile, revealInExplorer,
  isNotFoundError, getErrorMessage,
  type FileEntry,
} from "@/lib/ipc";
import { showContextMenu, createFileTreeActions } from "@/lib/context-menu";
import { useUIStore } from "@/stores/uiStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useAppStore } from "@/stores/appStore";
import { confirm } from "@tauri-apps/plugin-dialog";
import { watch, BaseDirectory } from "@tauri-apps/plugin-fs";
import { notify } from "@/hooks/useToast";
import { FileTree } from "@/panels/RunnerFileTree";
import { RenameDialog, NewFolderDialog, NewFileDialog } from "@/panels/RunnerDialogs";

export function SidebarFilesTab() {
  const { settings } = useAppStore();
  const { ps, setProjectSettings, openRunnerFile } = useProjectSettingsStore();
  const generatedDir = `projects/${settings.project}/generated`;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileParentDir, setNewFileParentDir] = useState<string>(generatedDir);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [newFolderTarget, setNewFolderTarget] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const expandedDirs = useMemo(() => new Set(ps.runnerExpandedDirs), [ps.runnerExpandedDirs]);
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const prev = new Set(useProjectSettingsStore.getState().ps.runnerExpandedDirs);
      const next = typeof updater === "function" ? updater(prev) : updater;
      setProjectSettings({ runnerExpandedDirs: [...next] });
    },
    [setProjectSettings]
  );

  const loadFiles = useCallback(async () => {
    try { setFiles(await readDir(generatedDir)); } catch (e) { setFiles([]); if (!isNotFoundError(e)) notify.error("Failed to load files", getErrorMessage(e)); }
  }, [generatedDir]);

  const refreshFiles = useCallback(() => {
    useUIStore.setState((s) => ({ fileTreeRefreshKey: s.fileTreeRefreshKey + 1 }));
  }, []);

  const fileTreeRefreshKey = useUIStore((s) => s.fileTreeRefreshKey);

  useEffect(() => { loadFiles(); }, [loadFiles, fileTreeRefreshKey]);

  useEffect(() => {
    let cancelled = false;
    let stopFn: (() => void) | null = null;
    (async () => {
      try {
        const unwatch = await watch(
          generatedDir,
          () => {
            if (!cancelled) {
              useUIStore.setState((s) => ({ fileTreeRefreshKey: s.fileTreeRefreshKey + 1 }));
            }
          },
          { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 500 },
        );
        if (cancelled) { unwatch(); return; }
        stopFn = unwatch;
      } catch (error) {
        console.warn("[watcher] failed to start:", error);
      }
    })();
    return () => {
      cancelled = true;
      stopFn?.();
    };
  }, [generatedDir]);

  const toggleDir = (path: string) => {
    const willExpand = !expandedDirs.has(path);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
    if (willExpand) loadFiles();
  };

  const handleDeleteFile = async (path: string) => {
    if (!(await confirm(`Delete ${path.split("/").pop()}?`))) return;
    await deleteFile(path);
    const { ps: cur, setProjectSettings: sps } = useProjectSettingsStore.getState();
    const newTabs = (cur.runnerEditorTabs ?? []).filter((t) => t !== path);
    const newActive = cur.runnerEditorActiveTabPath === path
      ? (newTabs[newTabs.length - 1] ?? null)
      : cur.runnerEditorActiveTabPath;
    sps({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    refreshFiles();
  };

  const handleDeleteDir = async (path: string) => {
    if (!(await confirm(`Delete folder ${path.split("/").pop()}?`))) return;
    await deleteDir(path);
    const { ps: cur, setProjectSettings: sps } = useProjectSettingsStore.getState();
    const newTabs = (cur.runnerEditorTabs ?? []).filter((t) => !t.startsWith(path + "/") && t !== path);
    const newActive = newTabs.includes(cur.runnerEditorActiveTabPath ?? "")
      ? cur.runnerEditorActiveTabPath
      : (newTabs[newTabs.length - 1] ?? null);
    sps({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    setExpandedDirs((prev) => { const next = new Set(prev); next.delete(path); return next; });
    refreshFiles();
  };

  const handleDeleteEntry = async (path: string, isDir: boolean) => {
    if (isDir) await handleDeleteDir(path); else await handleDeleteFile(path);
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    const path = `${newFileParentDir}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName(""); setShowNewFile(false); setNewFileParentDir(generatedDir);
    refreshFiles();
    openRunnerFile(path);
  };

  const startRename = (path: string) => {
    setRenameTarget({ path, name: path.split("/").pop() || "" });
    setRenameTo(path.split("/").pop() || "");
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const dir = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
    const newPath = `${dir}/${renameTo.trim()}`;
    try {
      await renameFile(renameTarget.path, newPath);
      const { ps: cur, setProjectSettings: sps } = useProjectSettingsStore.getState();
      if ((cur.runnerEditorTabs ?? []).includes(renameTarget.path)) {
        const newTabs = (cur.runnerEditorTabs ?? []).map((p) => p === renameTarget.path ? newPath : p);
        const newActive = cur.runnerEditorActiveTabPath === renameTarget.path ? newPath : cur.runnerEditorActiveTabPath;
        sps({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
      }
      refreshFiles();
    } catch (e) { notify.error("Rename failed", getErrorMessage(e)); }
    setRenameTarget(null);
  };

  const startNewFolder = (parentPath: string) => { setNewFolderTarget(parentPath); setNewFolderName(""); };
  const handleCreateFolder = async () => {
    if (!newFolderTarget || !newFolderName.trim()) return;
    try {
      await createDir(`${newFolderTarget}/${newFolderName.trim()}`);
      setExpandedDirs((prev) => { const next = new Set(prev); next.add(newFolderTarget!); return next; });
      refreshFiles();
    } catch (e) { notify.error("Create folder failed", getErrorMessage(e)); }
    setNewFolderTarget(null);
  };

  return (
    <ScrollArea className="h-full overflow-hidden">
      <div className="p-2">
        <div className="flex items-center justify-between mb-2 px-1">
          <span
            className="text-xs font-medium text-muted-foreground cursor-default"
            onContextMenu={(e) => {
              e.preventDefault();
              showContextMenu(
                createFileTreeActions({
                  onNewFile: () => { setNewFileParentDir(generatedDir); setShowNewFile(true); },
                  onNewFolder: () => startNewFolder(generatedDir),
                  onCollapseAll: () => setExpandedDirs(new Set()),
                  onReveal: () => revealInExplorer(generatedDir),
                  onRefresh: loadFiles,
                }),
                e.clientX,
                e.clientY
              );
            }}
          >
            generated/
          </span>
          <div className="flex gap-0.5">
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => startNewFolder(generatedDir)}><FolderPlus size={10} /></Button>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}><PlusIcon size={10} /></Button>
          </div>
        </div>
        {files.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
            <FolderOpen size={20} className="opacity-30" />
            <p className="text-xs font-medium">No files yet</p>
            <p className="text-[10px] opacity-60">Run or generate a project first</p>
          </div>
        )}
        <FileTree
          entries={files}
          selectedFile={ps.runnerEditorActiveTabPath}
          expandedDirs={expandedDirs}
          onToggleDir={toggleDir}
          onSelectFile={openRunnerFile}
          onDeleteEntry={handleDeleteEntry}
          onRename={startRename}
          onNewFile={(p) => { setNewFileParentDir(p); setNewFileName(""); setShowNewFile(true); }}
          onNewFolder={startNewFolder}
          onCollapse={(p) => setExpandedDirs((prev) => { const next = new Set(prev); next.delete(p); return next; })}
          onReveal={revealInExplorer}
          depth={0}
        />
      </div>
      <RenameDialog target={renameTarget} value={renameTo} onChange={setRenameTo} onConfirm={handleRename} onClose={() => setRenameTarget(null)} />
      <NewFolderDialog target={newFolderTarget} value={newFolderName} onChange={setNewFolderName} onConfirm={handleCreateFolder} onClose={() => setNewFolderTarget(null)} />
      <NewFileDialog open={showNewFile} value={newFileName} onChange={setNewFileName} onConfirm={handleCreateFile} onClose={() => setShowNewFile(false)} />
    </ScrollArea>
  );
}
