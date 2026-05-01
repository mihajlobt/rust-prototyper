import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import {
  Play, Square, Wrench, Package, PackagePlus, RotateCw,
  Minus, Plus, Smartphone, Tablet, Monitor,
  Terminal, ScrollText, Globe, Plus as PlusIcon,
  ChevronDown, ChevronUp, Save, FolderPlus, RefreshCw, Loader2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import {
  readDir, readFile, writeFile, createDir, deleteFile,
  deleteDir, renameFile, revealInExplorer,
  bunBuild, bunInstall, killAllProcesses, killPort, runShellCommand,
  isNotFoundError, getErrorMessage,
  type FileEntry,
} from "@/lib/ipc";
import { Input } from "@/components/ui/input";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useAppStore } from "@/stores/appStore";
import { useUIStore } from "@/stores/uiStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { confirm } from "@tauri-apps/plugin-dialog";
import { watch, BaseDirectory } from "@tauri-apps/plugin-fs";
import { notify } from "@/hooks/useToast";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { FileTree } from "@/panels/RunnerFileTree";
import { RenameDialog, NewFolderDialog, NewFileDialog } from "@/panels/RunnerDialogs";

export function RunnerPanel() {
  const { settings } = useAppStore();
  const { ps, setPs } = useProjectSettingsStore();
  const generatedDir = `projects/${settings.project}/generated`;
  const devServerStore = useDevServerStore();
  const running = devServerStore.runnerStatus === "running" || devServerStore.runnerStatus === "starting";
  const devUrl = devServerStore.runnerUrl;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const xtermRef = useRef<XTerminalHandle>(null);
  const logLinesRef = useRef<Array<{ line: string; source: string }>>([]);
  const [, setLogTick] = useState(0);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
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
        // Expected when generated/ doesn't exist yet; log for debugging other failures
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

  useEffect(() => {
    const unlistenPromise = onTerminalOutput((event: TerminalOutputEvent) => {
      xtermRef.current?.writeln(event.line);
      logLinesRef.current = [...logLinesRef.current, { line: event.line, source: event.source }];
      setLogTick((t) => t + 1);
      if (runningRef.current && iframeRef.current && devUrl && /updated|hmr/i.test(event.line)) {
        iframeRef.current.src = devUrl;
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [devUrl]);

  // ── Tab management ──────────────────────────────────────────────────────

  const openTab = useCallback(async (path: string) => {
    const newTabs = openTabs.includes(path) ? openTabs : [...openTabs, path];
    setPs({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: path });
    if (!tabContents[path]) {
      try {
        const content = await readFile(path);
        setTabContents((prev) => ({ ...prev, [path]: content }));
      } catch (e) { setTabContents((prev) => ({ ...prev, [path]: "" })); if (!isNotFoundError(e)) notify.error("Failed to load file", getErrorMessage(e)); }
    }
  }, [openTabs, tabContents, setPs]);

  const closeTab = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const newTabs = openTabs.filter((p) => p !== path);
    const newActive = path === activeTabPath
      ? (newTabs[newTabs.length - 1] ?? null)
      : activeTabPath;
    setPs({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    setTabContents((prev) => { const next = { ...prev }; delete next[path]; return next; });
    setDirtyTabs((prev) => { const next = new Set(prev); next.delete(path); return next; });
  }, [openTabs, activeTabPath, setPs]);

  const closeOtherTabs = useCallback((path: string) => {
    setPs({ runnerEditorTabs: [path], runnerEditorActiveTabPath: path });
    setTabContents((prev) => ({ [path]: prev[path] ?? "" }));
    setDirtyTabs((prev) => { const next = new Set<string>(); if (prev.has(path)) next.add(path); return next; });
  }, [setPs]);

  const closeTabsToRight = useCallback((path: string) => {
    const idx = openTabs.indexOf(path);
    const newTabs = openTabs.slice(0, idx + 1);
    const newActive = newTabs.includes(activeTabPath ?? "") ? activeTabPath : path;
    setPs({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
    setTabContents((prev) => Object.fromEntries(newTabs.map((p) => [p, prev[p] ?? ""])));
    setDirtyTabs((prev) => { const next = new Set<string>(); for (const p of newTabs) if (prev.has(p)) next.add(p); return next; });
  }, [openTabs, activeTabPath, setPs]);

  const closeAllTabs = useCallback(() => {
    setPs({ runnerEditorTabs: [], runnerEditorActiveTabPath: null });
    setTabContents({});
    setDirtyTabs(new Set());
  }, [setPs]);

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
    setExpandedDirs((prev) => { const next = new Set(prev); if (next.has(path)) next.delete(path); else { next.add(path); loadFiles(); } return next; });
  };

  const handleDeleteFile = async (path: string) => {
    if (!(await confirm(`Delete ${path.split("/").pop()}?`))) return;
    await deleteFile(path);
    if (openTabs.includes(path)) closeTab(path);
    loadFiles();
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    const path = `${newFileParentDir}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName(""); setShowNewFile(false); setNewFileParentDir(generatedDir);
    await loadFiles();
    openTab(path);
  };

  const handleDeleteDir = async (path: string) => {
    if (!(await confirm(`Delete folder ${path.split("/").pop()}?`))) return;
    await deleteDir(path);
    for (const tab of openTabs.filter((t) => t.startsWith(path))) closeTab(tab);
    expandedDirs.delete(path);
    loadFiles();
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
        setPs({ runnerEditorTabs: newTabs, runnerEditorActiveTabPath: newActive });
      }
      loadFiles();
    } catch (e) { notify.error("Rename failed", getErrorMessage(e)); }
    setRenameTarget(null);
  };

  const startNewFolder = (parentPath: string) => { setNewFolderTarget(parentPath); setNewFolderName(""); };
  const handleCreateFolder = async () => {
    if (!newFolderTarget || !newFolderName.trim()) return;
    try { await createDir(`${newFolderTarget}/${newFolderName.trim()}`); expandedDirs.add(newFolderTarget); loadFiles(); } catch (e) { notify.error("Create folder failed", getErrorMessage(e)); }
    setNewFolderTarget(null);
  };

  const handleKillAll = async () => {
    try { devServerStore.stopRunner(); await killAllProcesses(); await killPort(Array.from({ length: 12 }, (_, i) => 5173 + i)); notify.success("Killed all processes", "All active processes and ports 5173-5184 cleared"); }
    catch (e) { notify.error("Kill all failed", getErrorMessage(e)); }
  };

  const handleRefreshPreview = () => { if (iframeRef.current && devUrl) iframeRef.current.src = devUrl; };
  const handleNewShell = async () => {
    if (!shellCommand.trim()) return;
    xtermRef.current?.writeln(`\x1b[36m> ${shellCommand}\x1b[0m`);
    await runShellCommand(generatedDir, shellCommand);
    setShellCommand(""); setShowShellInput(false);
  };

  const zoomIn    = () => setPs({ runnerZoom: Math.min(ps.runnerZoom + 0.1, 2) });
  const zoomOut   = () => setPs({ runnerZoom: Math.max(ps.runnerZoom - 0.1, 0.3) });
  const zoomReset = () => setPs({ runnerZoom: 1 });

  const deviceWidth = { desktop: "100%", tablet: "768px", mobile: "375px" } as const;

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
                  <ContextMenu>
                    <ContextMenuTrigger asChild>
                      <span className="text-xs font-medium text-muted-foreground cursor-default">Files</span>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}><PlusIcon size={12} className="mr-2" />New File&#8230;</ContextMenuItem>
                      <ContextMenuItem onClick={() => startNewFolder(generatedDir)}><FolderPlus size={12} className="mr-2" />New Folder&#8230;</ContextMenuItem>
                      <ContextMenuItem onClick={() => setExpandedDirs(new Set())}>Collapse All</ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem onClick={() => revealInExplorer(generatedDir)}>Show in File Explorer</ContextMenuItem>
                      <ContextMenuItem onClick={loadFiles}><RefreshCw size={12} className="mr-2" />Refresh</ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                  <div className="flex gap-0.5">
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => startNewFolder(generatedDir)}><FolderPlus size={10} /></Button>
                    <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}><PlusIcon size={10} /></Button>
                  </div>
                </div>
                {files.length === 0 && <div className="text-xs text-muted-foreground px-1">No files yet</div>}
                <FileTree entries={files} selectedFile={activeTabPath} expandedDirs={expandedDirs} onToggleDir={toggleDir} onSelectFile={openTab} onDeleteEntry={handleDeleteEntry} onRename={startRename} onNewFile={(p) => { setNewFileParentDir(p); setNewFileName(""); setShowNewFile(true); }} onNewFolder={startNewFolder} onCollapse={(p) => { expandedDirs.delete(p); setExpandedDirs(new Set(expandedDirs)); }} onReveal={revealInExplorer} depth={0} />
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
                      <div className="h-full flex flex-col">
                        {/* Tab bar */}
                        {openTabs.length > 0 && (
                          <div className="flex items-stretch border-b border-border bg-card shrink-0" style={{ height: 32 }}>
                            <div className="flex items-stretch overflow-x-auto flex-1 min-w-0">
                            {openTabs.map((path) => {
                              const name = path.split("/").pop() ?? path;
                              const isActive = path === activeTabPath;
                              const isDirty = dirtyTabs.has(path);
                              const isLast = openTabs.indexOf(path) === openTabs.length - 1;
                              return (
                                <ContextMenu key={path}>
                                  <ContextMenuTrigger asChild>
                                    <button
                                      onClick={() => openTab(path)}
                                      onAuxClick={(e) => { if (e.button === 1) closeTab(path, e); }}
                                      className={["flex items-center gap-1.5 px-3 text-[11px] border-r border-border shrink-0 max-w-[160px] transition-colors", isActive ? "bg-background text-foreground border-b-2 border-b-primary -mb-px" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")}
                                    >
                                      {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                                      <span className="truncate">{name}</span>
                                      <X size={10} className="shrink-0 opacity-50 hover:opacity-100" onClick={(e) => closeTab(path, e)} />
                                    </button>
                                  </ContextMenuTrigger>
                                  <ContextMenuContent>
                                    <ContextMenuItem onClick={() => handleSaveFile()}>Save</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem onClick={() => closeTab(path)}>Close</ContextMenuItem>
                                    <ContextMenuItem onClick={() => closeOtherTabs(path)} disabled={openTabs.length <= 1}>Close Others</ContextMenuItem>
                                    <ContextMenuItem onClick={() => closeTabsToRight(path)} disabled={isLast}>Close to the Right</ContextMenuItem>
                                    <ContextMenuItem onClick={closeAllTabs}>Close All</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem onClick={() => revealInExplorer(path)}>Show in File Explorer</ContextMenuItem>
                                    <ContextMenuItem onClick={() => startRename(path)}>Rename…</ContextMenuItem>
                                    <ContextMenuItem onClick={() => navigator.clipboard.writeText(path)}>Copy Path</ContextMenuItem>
                                    <ContextMenuSeparator />
                                    <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => handleDeleteFile(path)}>Delete</ContextMenuItem>
                                  </ContextMenuContent>
                                </ContextMenu>
                              );
                            })}
                            </div>
                            {activeTabPath && (
                              <TooltipProvider delayDuration={400}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" className="h-6 w-6 my-auto mx-1 shrink-0" onClick={handleSaveFile}><Save size={11} /></Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Save (Ctrl+S)</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                          </div>
                        )}
                        {/* Editor body */}
                        {activeTabPath ? (
                          <div className="flex-1 overflow-hidden">
                            <CodeMirrorEditor
                              value={tabContents[activeTabPath] ?? ""}
                              onChange={handleContentChange}
                              onBlur={handleEditorBlur}
                              filename={activeTabPath}
                            />
                          </div>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">Select a file to edit</div>
                        )}
                      </div>
                    </Allotment.Pane>

                    {/* Preview */}
                    <Allotment.Pane minSize={300}>
                      <div className="h-full flex flex-col">
                        <div className="panel-toolbar h-7 px-2 gap-1 bg-card">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleRefreshPreview} title="Refresh"><RotateCw size={11} /></Button>
                          <div className="w-px h-3 bg-border" />
                          <div className="flex items-center gap-0.5">
                            <Button variant={ps.runnerDevice === "mobile"  ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "mobile"  })} title="Mobile" ><Smartphone size={11} /></Button>
                            <Button variant={ps.runnerDevice === "tablet"  ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "tablet"  })} title="Tablet" ><Tablet     size={11} /></Button>
                            <Button variant={ps.runnerDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "desktop" })} title="Desktop"><Monitor    size={11} /></Button>
                          </div>
                          <div className="w-px h-3 bg-border" />
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={zoomOut}><Minus size={11} /></Button>
                          <button className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer min-w-[32px] text-center select-none" onClick={zoomReset}>{Math.round(ps.runnerZoom * 100)}%</button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={zoomIn}><Plus size={11} /></Button>
                        </div>
                        <div className="flex-1 overflow-auto p-2 bg-muted/30 flex justify-center">
                          {devUrl ? (
                            <div className="h-full bg-background shadow-lg border border-border overflow-hidden" style={{ width: deviceWidth[ps.runnerDevice], transform: `scale(${ps.runnerZoom})`, transformOrigin: "top center" }}>
                              <iframe ref={iframeRef} src={devUrl} className="w-full h-full" sandbox="allow-scripts allow-same-origin allow-forms" />
                            </div>
                          ) : (
                            <div className="flex items-center justify-center text-muted-foreground text-sm">
                              <div className="text-center">
                                <Play size={32} className="mx-auto mb-3 opacity-30" />
                                <p>Click Run to start the dev server</p>
                                <p className="text-xs opacity-50 mt-1">Preview will appear here</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </Allotment.Pane>
                  </Allotment>
                </Allotment.Pane>

                {/* Terminal header */}
                <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
                  <div className="h-full flex items-center border-b border-border bg-card px-2">
                    <Tabs value={ps.runnerActiveTab} onValueChange={(v) => setPs({ runnerActiveTab: v as "terminal" | "logs" | "network" })}>
                      <TabsList variant="line" className="h-7">
                        <TabsTrigger value="terminal" className="text-[11px] gap-1"><Terminal size={10} />Terminal</TabsTrigger>
                        <TabsTrigger value="logs"     className="text-[11px] gap-1"><ScrollText size={10} />Logs</TabsTrigger>
                        <TabsTrigger value="network"  className="text-[11px] gap-1"><Globe size={10} />Network</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" className="gap-1 h-6 text-[10px] px-1.5" onClick={() => { setShowShellInput((v) => !v); if (!ps.runnerTerminalOpen) setPs({ runnerTerminalOpen: true }); }}><Terminal size={10} />Shell</Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPs({ runnerTerminalOpen: !ps.runnerTerminalOpen })}>{ps.runnerTerminalOpen ? <ChevronDown size={10} /> : <ChevronUp size={10} />}</Button>
                  </div>
                </Allotment.Pane>

                {/* Terminal content */}
                <Allotment.Pane visible={ps.runnerTerminalOpen} preferredSize={152} minSize={100}>
                  <div className="h-full flex flex-col">
                    {showShellInput && (
                      <div className="flex gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
                        <span className="text-xs text-muted-foreground self-center">$</span>
                        <Input value={shellCommand} onChange={(e) => setShellCommand(e.target.value)} placeholder="Enter shell command..." className="h-6 text-xs" onKeyDown={(e) => { if (e.key === "Enter") handleNewShell(); if (e.key === "Escape") setShowShellInput(false); }} autoFocus />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden">
                      <XTerminal ref={xtermRef} className={ps.runnerActiveTab === "terminal" ? "" : "hidden"} />
                      {ps.runnerActiveTab === "logs" && (
                        <ScrollArea className="h-full overflow-hidden bg-black font-mono text-xs"><div className="p-2 space-y-0.5">
                          {logLinesRef.current.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).map((item, i) => (
                            <div key={i} className={["break-all whitespace-pre-wrap", item.line.toLowerCase().includes("error") ? "text-red-400" : item.line.toLowerCase().includes("warning") ? "text-yellow-400" : "text-green-400"].join(" ")}>{item.line}</div>
                          ))}
                          {logLinesRef.current.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).length === 0 && <div className="text-green-400 opacity-40">No log events yet…</div>}
                        </div></ScrollArea>
                      )}
                      {ps.runnerActiveTab === "network" && (
                        <ScrollArea className="h-full overflow-hidden bg-black font-mono text-xs"><div className="p-2 space-y-1">
                          {(() => {
                            const requests = logLinesRef.current.map((item) => {
                              const match = item.line.match(/(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
                              if (match) return { method: match[1], path: match[2], status: parseInt(match[3]) };
                              const hmr = item.line.match(/hmr update\s+(\S+)/i);
                              if (hmr) return { method: "HMR", path: hmr[1], status: 0 };
                              return null;
                            }).filter(Boolean) as Array<{ method: string; path: string; status: number }>;
                            if (requests.length === 0) return <div className="text-green-400 opacity-40">No network requests logged yet…</div>;
                            return requests.map((req, i) => (
                              <div key={i} className="flex items-center gap-2">
                                <span className={["font-bold px-1 py-0.5 rounded", req.status >= 200 && req.status < 300 ? "bg-green-500/20 text-green-400" : req.status >= 400 ? "bg-red-500/20 text-red-400" : req.method === "HMR" ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground"].join(" ")}>{req.method}</span>
                                <span className="truncate flex-1 text-green-400">{req.path}</span>
                                {req.status > 0 && <span className="text-green-400 opacity-50">{req.status}</span>}
                              </div>
                            ));
                          })()}
                        </div></ScrollArea>
                      )}
                    </div>
                  </div>
                </Allotment.Pane>
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
