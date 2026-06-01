import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import type { XTerminalHandle } from "@/components/XTerminal";
import {
  Play, Square, Wrench, Package, PackagePlus, Loader2,
  Plus as PlusIcon, FolderPlus, FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  readDir, readFile, writeFile, createDir, deleteFile,
  deleteDir, renameFile, revealInExplorer,
  bunBuild, bunInstall, killAllProcesses, killPort, runShellCommand,
  isNotFoundError, getErrorMessage,
  type FileEntry,
} from "@/lib/ipc";
import { showContextMenu, createFileTreeActions } from "@/lib/context-menu";
import { useAppStore } from "@/stores/appStore";
import { useUIStore } from "@/stores/uiStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { confirm } from "@tauri-apps/plugin-dialog";
import { watch, BaseDirectory } from "@tauri-apps/plugin-fs";
import { notify } from "@/hooks/useToast";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { getGeneratedAppTsx, PROJECT_PATHS as GEN_PATHS } from "@/lib/scaffold-shadcn";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { FileTree } from "@/panels/RunnerFileTree";
import { RenameDialog, NewFolderDialog, NewFileDialog } from "@/panels/RunnerDialogs";
import { RunnerEditor } from "@/panels/runner/RunnerEditor";
import { RunnerPreview } from "@/panels/runner/RunnerPreview";
import { RunnerTerminal } from "@/panels/runner/RunnerTerminal";

export function RunnerPanel() {
  const { settings } = useAppStore();
  const { ps, setProjectSettings } = useProjectSettingsStore();
  const generatedDir = `projects/${settings.project}/generated`;
  const devServerStore = useDevServerStore();
  const running = devServerStore.runnerStatus === "running" || devServerStore.runnerStatus === "starting";
  const devUrl = devServerStore.runnerUrl;
  const runnerDark = ps.runnerDarkPreview;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const xtermRef = useRef<XTerminalHandle>(null);
  const logLinesRef = useRef<Array<{ line: string; source: string }>>([]);
  const [, setLogTick] = useState(0);
  // File-tree expansion persists per-project. Backed by a string[] in projectSettingsStore;
  // exposed here as a Set with a functional setter for ergonomic call sites.
  const expandedDirs = useMemo(() => new Set(ps.runnerExpandedDirs), [ps.runnerExpandedDirs]);
  const setExpandedDirs = useCallback(
    (updater: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const prev = new Set(useProjectSettingsStore.getState().ps.runnerExpandedDirs);
      const next = typeof updater === "function" ? updater(prev) : updater;
      setProjectSettings({ runnerExpandedDirs: [...next] });
    },
    [setProjectSettings]
  );
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileParentDir, setNewFileParentDir] = useState<string>(generatedDir);
  const [isScaffolding, setIsScaffolding] = useState(false);
  const [shellCommand, setShellCommand] = useState("");
  const [showShellInput, setShowShellInput] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [newFolderTarget, setNewFolderTarget] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");

  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("runner", 2);
  const { ref: verticalRef, onDragEnd: verticalOnDragEnd, defaultSizes: verticalDefault } = useAllotmentLayout("runner-terminal", 3);
  const { ref: editorRef, onDragEnd: editorOnDragEnd, defaultSizes: editorDefault } = useAllotmentLayout("runner-editor", 2);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTabPath = ps.runnerEditorActiveTabPath;
  const openTabs = useMemo(() => ps.runnerEditorTabs ?? [], [ps.runnerEditorTabs]);

  const loadFiles = useCallback(async () => {
    try { setFiles(await readDir(generatedDir)); } catch (e) { setFiles([]); if (!isNotFoundError(e)) notify.error("Failed to load files", getErrorMessage(e)); }
  }, [generatedDir]);

  const fileTreeRefreshKey = useUIStore((s) => s.fileTreeRefreshKey);

  // Bump the shared refresh key after a file mutation. This re-runs loadFiles (top level)
  // AND reloads every expanded AsyncDirChildren — so nested changes show immediately,
  // without depending on the FS watcher (which debounces 500ms and can fail to start).
  const refreshFiles = useCallback(() => {
    useUIStore.setState((s) => ({ fileTreeRefreshKey: s.fileTreeRefreshKey + 1 }));
  }, []);

  useEffect(() => { loadFiles(); }, [loadFiles, fileTreeRefreshKey]);

  // File watcher for auto-refresh
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

  useEffect(() => {
    if (activeTabPath && !tabContents[activeTabPath]) {
      readFile(activeTabPath).then((content) => {
        setTabContents((prev) => ({ ...prev, [activeTabPath]: content }));
      }).catch((e) => { if (!isNotFoundError(e)) notify.error("Failed to load file", e.message); });
    }
    // only run when activeTabPath changes — including tabContents would cause an infinite loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTabPath]);

  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);

  // Reload iframe on HMR — dark mode is sent via postMessage, not URL param
  useEffect(() => {
    const unlistenPromise = onTerminalOutput((event: TerminalOutputEvent) => {
      xtermRef.current?.writeln(event.line);
      logLinesRef.current = [...logLinesRef.current, { line: event.line, source: event.source }];
      setLogTick((t) => t + 1);
      if (runningRef.current && iframeRef.current && devUrl) {
        const base = devUrl.endsWith("/") ? devUrl.slice(0, -1) : devUrl;
        iframeRef.current.src = base;
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [devUrl]);

  // ── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(async (path: string) => {
    const newTabs = openTabs.includes(path) ? openTabs : [...openTabs, path];
    setProjectSettings({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: path });
    if (!tabContents[path]) {
      try {
        const content = await readFile(path);
        setTabContents((prev) => ({ ...prev, [path]: content }));
      } catch (e) { setTabContents((prev) => ({ ...prev, [path]: "" })); if (!isNotFoundError(e)) notify.error("Failed to load file", getErrorMessage(e)); }
    }
  }, [openTabs, tabContents, setProjectSettings]);

  const closeTab = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newTabs = openTabs.filter((p) => p !== path);
    const newActive = path === activeTabPath
      ? (newTabs[newTabs.length - 1] ?? null)
      : activeTabPath;
    setProjectSettings({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    setTabContents((prev) => { const next = { ...prev }; delete next[path]; return next; });
    setDirtyTabs((prev) => { const next = new Set(prev); next.delete(path); return next; });
  }, [openTabs, activeTabPath, setProjectSettings]);

  const closeOtherTabs = useCallback((path: string) => {
    setProjectSettings({ runnerEditorTabs: [path], runnerEditorActiveTabPath: path });
    setTabContents((prev) => ({ [path]: prev[path] ?? "" }));
    setDirtyTabs((prev) => { const next = new Set<string>(); if (prev.has(path)) next.add(path); return next; });
  }, [setProjectSettings]);

  const closeTabsToRight = useCallback((path: string) => {
    const idx = openTabs.indexOf(path);
    const newTabs = openTabs.slice(0, idx + 1);
    const newActive = newTabs.includes(activeTabPath ?? "") ? activeTabPath : path;
    setProjectSettings({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    setTabContents((prev) => Object.fromEntries(newTabs.map((p) => [p, prev[p] ?? ""])));
    setDirtyTabs((prev) => { const next = new Set<string>(); for (const p of newTabs) if (prev.has(p)) next.add(p); return next; });
  }, [openTabs, activeTabPath, setProjectSettings]);

  const closeAllTabs = useCallback(() => {
    setProjectSettings({ runnerEditorTabs: [], runnerEditorActiveTabPath: null });
    setTabContents({});
    setDirtyTabs(new Set());
  }, [setProjectSettings]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeTabPath) return;
    setTabContents((prev) => ({ ...prev, [activeTabPath]: content }));
    setDirtyTabs((prev) => new Set([...prev, activeTabPath]));
  }, [activeTabPath]);

  const handleSaveFile = useCallback(async () => {
    if (!activeTabPath) return;
    const content = tabContents[activeTabPath] ?? "";
    try {
      await writeFile(activeTabPath, content);
      setDirtyTabs((prev) => { const next = new Set(prev); next.delete(activeTabPath); return next; });
    } catch (e) { notify.error("Save failed", getErrorMessage(e)); }
  }, [activeTabPath, tabContents]);

  const handleEditorBlur = useCallback(() => { handleSaveFile(); }, [handleSaveFile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSaveFile(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile]);

  // ── Scaffold + dev server ───────────────────────────────────────────────

  const ensureScaffold = async (): Promise<boolean> => {
    const scaffolded = await hasGeneratedScaffold(`projects/${settings.project}`);
    if (scaffolded) {
      await ensureEslintPatched(`projects/${settings.project}`);
      // Migrate App.tsx to the AppRouter pattern if it predates this feature
      try {
        const appTsx = await readFile(`${generatedDir}/${GEN_PATHS.SRC.APP_TSX}`);
        if (!appTsx.includes("AppRouter")) {
          await writeFile(`${generatedDir}/${GEN_PATHS.SRC.APP_TSX}`, getGeneratedAppTsx());
          notify.info("App.tsx updated", "Migrated to AppRouter pattern for multi-screen navigation");
        }
      } catch { /* non-fatal — old App.tsx stays as-is */ }
      return true;
    }
    const ok = await confirm("The generated/ folder needs a Vite + React + shadcn/ui project. Create one now?");
    if (!ok) return false;
    setIsScaffolding(true);
    xtermRef.current?.writeln("\r\n\x1b[90m─────────────────────────────────\x1b[0m");
    try {
      await withScaffoldNotifications("scaffold-generated", "Scaffolding generated project", (onStep) => {
        const wrappedStep = (msg: string) => { xtermRef.current?.writeln(`\x1b[36m${msg}\x1b[0m`); onStep(msg); };
        return scaffoldGenerated(generatedDir, settings.iconLibrary, wrappedStep);
      });
      await loadFiles();
      xtermRef.current?.writeln("\x1b[32m✓ scaffold complete\x1b[0m");
      return true;
    } catch { return false; } finally { setIsScaffolding(false); }
  };

  const handleRun = async () => {
    if (running) { try { devServerStore.stopRunner(); } catch (e) { notify.error("Failed to stop", getErrorMessage(e)); } return; }
    if (!(await ensureScaffold())) return;
    xtermRef.current?.writeln("\x1b[36m> starting dev server…\x1b[0m");
    try { await devServerStore.startRunner(generatedDir, ps.runnerPort); } catch (e) { notify.error("Failed to start", getErrorMessage(e)); }
  };

  const handleBuild   = async () => { if (!(await ensureScaffold())) return; xtermRef.current?.writeln("\x1b[36m> bun build\x1b[0m"); try { await bunBuild(generatedDir); } catch (e) { notify.error("Build failed", getErrorMessage(e)); } };
  const handleInstall = async () => { xtermRef.current?.writeln("\x1b[36m> bun install\x1b[0m"); try { await bunInstall(generatedDir); } catch (e) { notify.error("Install failed", getErrorMessage(e)); } };

  // ── File operations ─────────────────────────────────────────────────────

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
    if (openTabs.includes(path)) closeTab(path);
    refreshFiles();
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    const path = `${newFileParentDir}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName(""); setShowNewFile(false); setNewFileParentDir(generatedDir);
    refreshFiles();
    openTab(path);
  };

  const handleDeleteDir = async (path: string) => {
    if (!(await confirm(`Delete folder ${path.split("/").pop()}?`))) return;
    await deleteDir(path);
    for (const tab of openTabs.filter((t) => t.startsWith(path))) closeTab(tab);
    setExpandedDirs((prev) => { const next = new Set(prev); next.delete(path); return next; });
    refreshFiles();
  };

  const handleDeleteEntry = async (path: string, isDir: boolean) => { if (isDir) await handleDeleteDir(path); else await handleDeleteFile(path); };
  const startRename = (path: string) => { setRenameTarget({ path, name: path.split("/").pop() || "" }); setRenameTo(path.split("/").pop() || ""); };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const dir = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
    const newPath = `${dir}/${renameTo.trim()}`;
    try {
      await renameFile(renameTarget.path, newPath);
      if (openTabs.includes(renameTarget.path)) {
        const newTabs = openTabs.map((p) => p === renameTarget.path ? newPath : p);
        const newActive = activeTabPath === renameTarget.path ? newPath : activeTabPath;
        setTabContents((prev) => { const next = { ...prev }; if (next[renameTarget.path] !== undefined) { next[newPath] = next[renameTarget.path]; delete next[renameTarget.path]; } return next; });
        setProjectSettings({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
      }
      refreshFiles();
    } catch (e) { notify.error("Rename failed", getErrorMessage(e)); }
    setRenameTarget(null);
  };

  const startNewFolder = (parentPath: string) => { setNewFolderTarget(parentPath); setNewFolderName(""); };
  const handleCreateFolder = async () => {
    if (!newFolderTarget || !newFolderName.trim()) return;
    try { await createDir(`${newFolderTarget}/${newFolderName.trim()}`); setExpandedDirs((prev) => { const next = new Set(prev); next.add(newFolderTarget); return next; }); refreshFiles(); } catch (e) { notify.error("Create folder failed", getErrorMessage(e)); }
    setNewFolderTarget(null);
  };

  const handleKillAll = async () => {
    try { devServerStore.stopRunner(); await killAllProcesses(); await killPort(Array.from({ length: 12 }, (_, i) => 5173 + i)); notify.success("Killed all processes", "All active processes and ports 5173-5184 cleared"); }
    catch (e) { notify.error("Kill all failed", getErrorMessage(e)); }
  };

  const handleRefreshPreview = () => {
    if (!iframeRef.current || !devUrl) return;
    iframeRef.current.contentWindow?.postMessage({ type: "reload" }, "*");
  };
  const handleNewShell = async () => {
    if (!shellCommand.trim()) return;
    xtermRef.current?.writeln(`\x1b[36m> ${shellCommand}\x1b[0m`);
    await runShellCommand(generatedDir, shellCommand);
    setShellCommand(""); setShowShellInput(false);
  };

  const zoomIn    = () => setProjectSettings({ runnerZoom: Math.min(ps.runnerZoom + 0.1, 2) });
  const zoomOut   = () => setProjectSettings({ runnerZoom: Math.max(ps.runnerZoom - 0.1, 0.3) });
  const zoomReset = () => setProjectSettings({ runnerZoom: 1 });

  return (
    <div className="h-full flex flex-col">
      <div className="panel-toolbar h-9 px-2 gap-1 bg-card">
        <Button variant={running ? "destructive" : "default"} size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleRun} disabled={isScaffolding}>
          {isScaffolding ? <Loader2 size={10} className="animate-spin" /> : running ? <Square size={10} /> : <Play size={10} />}
          {isScaffolding ? "Scaffolding…" : running ? "Stop" : "Run"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleBuild} disabled={isScaffolding}><Wrench size={10} />Build</Button>
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleInstall}><Package size={10} />Install</Button>
        <AddLibraryModal trigger={<Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2"><PackagePlus size={10} />Library</Button>} />
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleKillAll}><Square size={10} />Kill All</Button>
      </div>

      <div className="flex-1 overflow-hidden">
        <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
          {/* File Tree */}
          <Allotment.Pane preferredSize={200} minSize={150}>
            <ScrollArea className="h-full overflow-hidden bg-card border-r border-border">
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
                    Files
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
                      <p className="text-[10px] opacity-60">Files from your generated project will appear here</p>
                    </div>
                  )}
                <FileTree entries={files} selectedFile={activeTabPath} expandedDirs={expandedDirs} onToggleDir={toggleDir} onSelectFile={openTab} onDeleteEntry={handleDeleteEntry} onRename={startRename} onNewFile={(p) => { setNewFileParentDir(p); setNewFileName(""); setShowNewFile(true); }} onNewFolder={startNewFolder} onCollapse={(p) => setExpandedDirs((prev) => { const next = new Set(prev); next.delete(p); return next; })} onReveal={revealInExplorer} depth={0} />
              </div>
            </ScrollArea>
          </Allotment.Pane>

          {/* Editor + Preview + Terminal */}
          <Allotment.Pane>
            <div className="h-full flex flex-col">
              <Allotment vertical ref={verticalRef} onDragEnd={verticalOnDragEnd} defaultSizes={verticalDefault} className="flex-1 min-h-0">
                <Allotment.Pane>
                  <Allotment ref={editorRef} onDragEnd={editorOnDragEnd} defaultSizes={editorDefault}>
                    {/* Editor with tabs */}
                    <Allotment.Pane minSize={200}>
                      <RunnerEditor
                        openTabs={openTabs}
                        activeTabPath={activeTabPath}
                        tabContents={tabContents}
                        dirtyTabs={dirtyTabs}
                        openTab={openTab}
                        closeTab={closeTab}
                        closeOtherTabs={closeOtherTabs}
                        closeTabsToRight={closeTabsToRight}
                        closeAllTabs={closeAllTabs}
                        handleSaveFile={handleSaveFile}
                        handleContentChange={handleContentChange}
                        handleEditorBlur={handleEditorBlur}
                        startRename={startRename}
                        handleDeleteFile={handleDeleteFile}
                        revealInExplorer={revealInExplorer}
                      />
                    </Allotment.Pane>

                    {/* Preview */}
                    <Allotment.Pane minSize={300}>
                      <RunnerPreview
                        devUrl={devUrl}
                        runnerDark={runnerDark}
                        runnerDevice={ps.runnerDevice}
                        runnerZoom={ps.runnerZoom}
                        iframeRef={iframeRef}
                        setProjectSettings={setProjectSettings}
                        handleRefreshPreview={handleRefreshPreview}
                        zoomIn={zoomIn}
                        zoomOut={zoomOut}
                        zoomReset={zoomReset}
                      />
                    </Allotment.Pane>
                  </Allotment>
                </Allotment.Pane>

                {/* Terminal: header pane + content pane as a fragment */}
                <RunnerTerminal
                  xtermRef={xtermRef}
                  runnerActiveTab={ps.runnerActiveTab}
                  runnerTerminalOpen={ps.runnerTerminalOpen}
                  showShellInput={showShellInput}
                  shellCommand={shellCommand}
                  logLinesRef={logLinesRef}
                  setShowShellInput={setShowShellInput}
                  setShellCommand={setShellCommand}
                  setProjectSettings={setProjectSettings}
                  handleNewShell={handleNewShell}
                />
              </Allotment>
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      <RenameDialog target={renameTarget} value={renameTo} onChange={setRenameTo} onConfirm={handleRename} onClose={() => setRenameTarget(null)} />
      <NewFolderDialog target={newFolderTarget} value={newFolderName} onChange={setNewFolderName} onConfirm={handleCreateFolder} onClose={() => setNewFolderTarget(null)} />
      <NewFileDialog open={showNewFile} value={newFileName} onChange={setNewFileName} onConfirm={handleCreateFile} onClose={() => setShowNewFile(false)} />
    </div>
  );
}
