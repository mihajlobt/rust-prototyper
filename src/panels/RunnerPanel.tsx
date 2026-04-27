import { useState, useEffect, useCallback, useRef } from "react";
import { Allotment } from "allotment";
import { onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import {
  Play,
  Square,
  Wrench,
  Package,
  PackagePlus,
  RotateCw,
  Minus,
  Plus,
  Smartphone,
  Tablet,
  Monitor,
  Folder,
  FileCode,
  Terminal,
  ScrollText,
  Globe,
  Plus as PlusIcon,
  ChevronDown,
  ChevronUp,
  Save,
  FolderPlus,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import {
  readDir,
  readFile,
  writeFile,
  createDir,
  deleteFile,
  deleteDir,
  renameFile,
  revealInExplorer,
  bunBuild,
  bunInstall,
  killAllProcesses,
  killPort,
  runShellCommand,
  type FileEntry,
} from "@/lib/ipc";
import { Input } from "@/components/ui/input";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/stores/appStore";
import { useUIStore } from "@/stores/uiStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { MentionAsset } from "@/types/chat";
import { notify } from "@/hooks/useToast";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { hasGeneratedScaffold, scaffoldGenerated } from "@/lib/scaffold";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import { useDevServerStore } from "@/lib/dev-server-manager";

export function RunnerPanel() {
  const { settings } = useAppStore();
  const { ps, setPs } = useProjectSettingsStore();
  const generatedDir = `projects/${settings.project}/generated`;
  const runnerDevice = ps.runnerDevice;
  const runnerZoom = ps.runnerZoom;
  const runnerTerminalOpen = ps.runnerTerminalOpen;
  const runnerActiveTab = ps.runnerActiveTab;
  const runnerPort = ps.runnerPort;
  const fileTreeNonce = useUIStore((s) => s.runnerFileTreeNonce);
  const devServerStore = useDevServerStore();
  const running = devServerStore.runnerStatus === "running" || devServerStore.runnerStatus === "starting";
  const devUrl = devServerStore.runnerUrl;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [terminalLines, setTerminalLines] = useState<Array<{ line: string; source: string }>>([]);
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
  const shellPidRef = useRef<number | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  } as const;

  const loadFiles = useCallback(async () => {
    try {
      const entries = await readDir(generatedDir);
      setFiles(entries);
    } catch {
      setFiles([]);
    }
  }, [generatedDir]);

  useEffect(() => { loadFiles(); }, [loadFiles]);
  useEffect(() => { if (fileTreeNonce > 0) loadFiles(); }, [fileTreeNonce, loadFiles]);

  const runningRef = useRef(running);
  useEffect(() => { runningRef.current = running; }, [running]);

  useEffect(() => {
    const unlistenPromise = onTerminalOutput((event: TerminalOutputEvent) => {
      setTerminalLines((prev) => [...prev, { line: event.line, source: event.source }]);
      if (runningRef.current && iframeRef.current && /updated|hmr/i.test(event.line)) {
        iframeRef.current.contentWindow?.location.reload();
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines]);

  const handleSelectFile = async (path: string) => {
    setSelectedFile(path);
    try { setFileContent(await readFile(path)); } catch { setFileContent(""); }
  };

  const handleSaveFile = useCallback(async () => {
    if (!selectedFile) return;
    try { await writeFile(selectedFile, fileContent); } catch (e) { notify.error("Save failed", e instanceof Error ? e.message : String(e)); }
  }, [selectedFile, fileContent]);

  const handleEditorBlur = useCallback(() => { handleSaveFile(); }, [handleSaveFile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSaveFile(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile]);


  const projectDir = `projects/${settings.project}`;

  const ensureScaffold = async (): Promise<boolean> => {
    // hasGeneratedScaffold expects the project dir (appends /generated internally)
    const scaffolded = await hasGeneratedScaffold(projectDir);
    if (scaffolded) return true;
    const ok = await confirm("The generated/ folder needs a Vite + React + shadcn/ui project. Create one now?");
    if (!ok) return false;
    setIsScaffolding(true);
    setTerminalLines((prev) => [
      ...prev,
      { line: "─────────────────────────────────", source: "stdout" },
    ]);
    const onStep = (msg: string) =>
      setTerminalLines((prev) => [...prev, { line: msg, source: "stdout" }]);
    try {
      await scaffoldGenerated(generatedDir, settings.iconLibrary, onStep);
      await loadFiles();
      setTerminalLines((prev) => [...prev, { line: "✓ scaffold complete", source: "stdout" }]);
      notify.success("Scaffold complete", "Vite + React + shadcn/ui project created in generated/");
      return true;
    } catch (e) {
      notify.error("Scaffold failed", e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setIsScaffolding(false);
    }
  };

  const handleRun = async () => {
    if (running) {
      try { devServerStore.stopRunner(); } catch (e) { notify.error("Failed to stop dev server", e instanceof Error ? e.message : String(e)); }
      return;
    }
    if (!(await ensureScaffold())) return;
    setTerminalLines((prev) => [...prev, { line: "> starting dev server...", source: "stdout" }]);
    try {
      await devServerStore.startRunner(generatedDir, runnerPort);
    } catch (e) { notify.error("Failed to start dev server", e instanceof Error ? e.message : String(e)); }
  };

  const handleBuild = async () => {
    if (!(await ensureScaffold())) return;
    setTerminalLines((prev) => [...prev, { line: "> bun build", source: "stdout" }]);
    try { await bunBuild(generatedDir); } catch (e) { notify.error("Build failed", e instanceof Error ? e.message : String(e)); }
  };

  const handleInstall = async () => {
    setTerminalLines((prev) => [...prev, { line: "> bun install", source: "stdout" }]);
    try { await bunInstall(generatedDir); } catch (e) { notify.error("Install failed", e instanceof Error ? e.message : String(e)); }
  };

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => { const next = new Set(prev); if (next.has(path)) { next.delete(path); } else { next.add(path); loadFiles(); } return next; });
  };

  const handleDeleteFile = async (path: string) => {
    if (!(await confirm(`Delete ${path.split("/").pop()}?`))) return;
    await deleteFile(path);
    if (selectedFile === path) { setSelectedFile(null); setFileContent(""); }
    loadFiles();
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    const path = `${newFileParentDir}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName("");
    setShowNewFile(false);
    setNewFileParentDir(generatedDir);
    loadFiles();
    handleSelectFile(path);
  };

  const handleDeleteDir = async (path: string) => {
    if (!(await confirm(`Delete folder ${path.split("/").pop()}?`))) return;
    await deleteDir(path);
    if (selectedFile?.startsWith(path)) { setSelectedFile(null); setFileContent(""); }
    expandedDirs.delete(path);
    loadFiles();
  };

  const handleDeleteEntry = async (path: string, isDir: boolean) => {
    if (isDir) { await handleDeleteDir(path); } else { await handleDeleteFile(path); }
  };

  const startRename = (path: string) => { setRenameTarget({ path, name: path.split("/").pop() || "" }); setRenameTo(path.split("/").pop() || ""); };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const dir = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
    const newPath = `${dir}/${renameTo.trim()}`;
    try { await renameFile(renameTarget.path, newPath); if (selectedFile === renameTarget.path) setSelectedFile(newPath); loadFiles(); } catch (e) { notify.error("Rename failed", e instanceof Error ? e.message : String(e)); }
    setRenameTarget(null);
  };

  const startNewFolder = (parentPath: string) => { setNewFolderTarget(parentPath); setNewFolderName(""); };

  const handleCreateFolder = async () => {
    if (!newFolderTarget || !newFolderName.trim()) return;
    const path = `${newFolderTarget}/${newFolderName.trim()}`;
    try { await createDir(path); expandedDirs.add(newFolderTarget); loadFiles(); } catch (e) { notify.error("Create folder failed", e instanceof Error ? e.message : String(e)); }
    setNewFolderTarget(null);
  };

  const handleNewFileInDir = (parentPath: string) => { setNewFileParentDir(parentPath); setNewFileName(""); setShowNewFile(true); };

  const collapseAll = () => setExpandedDirs(new Set());

  const getFileMode = (path: string): "tsx" | "css" | "json" | "javascript" => {
    if (path.endsWith(".css")) return "css";
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".tsx") || path.endsWith(".jsx")) return "tsx";
    return "javascript";
  };

  const handleNewShell = async () => {
    if (!shellCommand.trim()) return;
    setTerminalLines((prev) => [...prev, { line: `> ${shellCommand}`, source: "stdout" }]);
    const pid = await runShellCommand(generatedDir, shellCommand);
    shellPidRef.current = pid;
    setShellCommand("");
    setShowShellInput(false);
  };

  const handleKillAll = async () => {
    try {
      devServerStore.stopRunner();
      await killAllProcesses();
      await killPort(Array.from({ length: 12 }, (_, i) => 5173 + i));
      notify.success("Killed all processes", "All active processes and ports 5173-5184 cleared");
    } catch (e) { notify.error("Kill all failed", e instanceof Error ? e.message : String(e)); }
  };

  const handleRefreshPreview = () => { iframeRef.current?.contentWindow?.location.reload(); };

  const zoomIn = () => setPs({ runnerZoom: Math.min(runnerZoom + 0.1, 2) });
  const zoomOut = () => setPs({ runnerZoom: Math.max(runnerZoom - 0.1, 0.3) });
  const zoomReset = () => setPs({ runnerZoom: 1 });

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="panel-toolbar h-9 px-2 gap-1 bg-card">
        <Button variant={running ? "destructive" : "default"} size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleRun} disabled={isScaffolding}>
          {isScaffolding ? <Loader2 size={10} className="animate-spin" /> : running ? <Square size={10} /> : <Play size={10} />}
          {isScaffolding ? "Scaffolding…" : running ? "Stop" : "Run"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleBuild} disabled={isScaffolding}>
          <Wrench size={10} />Build
        </Button>
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleInstall}>
          <Package size={10} />Install
        </Button>
        <AddLibraryModal trigger={
          <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2">
            <PackagePlus size={10} />Library
          </Button>
        } />
        <Button variant="outline" size="sm" className="gap-1 h-6 text-[11px] px-2" onClick={handleKillAll}>
          <Square size={10} />Kill All
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
          {/* File Tree */}
          <Allotment.Pane preferredSize={200} minSize={150}>
            <div className="h-full overflow-auto p-2 bg-card border-r border-border">
              <div className="flex items-center justify-between mb-2 px-1">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <span className="text-xs font-medium text-muted-foreground cursor-default">Files</span>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}><PlusIcon size={12} className="mr-2" /> New File&#8230;</ContextMenuItem>
                    <ContextMenuItem onClick={() => startNewFolder(generatedDir)}><FolderPlus size={12} className="mr-2" /> New Folder&#8230;</ContextMenuItem>
                    <ContextMenuItem onClick={collapseAll}>Collapse All</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => revealInExplorer(generatedDir)}>Show in File Explorer</ContextMenuItem>
                    <ContextMenuItem onClick={loadFiles}><RefreshCw size={12} className="mr-2" /> Refresh</ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => startNewFolder(generatedDir)}><FolderPlus size={10} /></Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}><PlusIcon size={10} /></Button>
                </div>
              </div>
              {files.length === 0 && <div className="text-xs text-muted-foreground px-1">No files yet</div>}
              <FileTree entries={files} selectedFile={selectedFile} expandedDirs={expandedDirs} onToggleDir={toggleDir} onSelectFile={handleSelectFile} onDeleteEntry={handleDeleteEntry} onRename={startRename} onNewFile={handleNewFileInDir} onNewFolder={startNewFolder} onCollapse={(path) => { expandedDirs.delete(path); setExpandedDirs(new Set(expandedDirs)); }} onReveal={(path) => revealInExplorer(path)} depth={0} nonce={fileTreeNonce} />
            </div>
          </Allotment.Pane>

          {/* Editor + Preview + Terminal */}
          <Allotment.Pane>
            <div className="h-full flex flex-col">
              <Allotment vertical ref={verticalRef} onDragEnd={verticalOnDragEnd} defaultSizes={verticalDefault} className="flex-1 min-h-0">
                <Allotment.Pane>
                  <Allotment ref={editorRef} onDragEnd={editorOnDragEnd} defaultSizes={editorDefault}>
                    {/* Editor */}
                    <Allotment.Pane minSize={200}>
                      {selectedFile ? (
                        <div className="h-full flex flex-col">
                          <div className="panel-toolbar h-7 px-3 gap-2 bg-card">
                            <span className="text-[11px] font-medium text-muted-foreground">{selectedFile.split("/").pop()}</span>
                            <div className="flex-1" />
                            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleSaveFile}><Save size={12} /></Button>
                          </div>
                          <div className="flex-1 overflow-hidden">
                            <CodeMirrorEditor value={fileContent} onChange={setFileContent} onBlur={handleEditorBlur} mode={getFileMode(selectedFile)} />
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4">Select a file to edit</div>
                      )}
                    </Allotment.Pane>

                    {/* Preview */}
                    <Allotment.Pane minSize={300}>
                      <div className="h-full flex flex-col">
                        {/* Chrome DevTools-style device toolbar */}
                        <div className="panel-toolbar h-7 px-2 gap-1 bg-card">
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={handleRefreshPreview} title="Refresh"><RotateCw size={11} /></Button>
                          <div className="w-px h-3 bg-border" />
                          <div className="flex items-center gap-0.5">
                            <Button variant={runnerDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "mobile" })} title="Mobile"><Smartphone size={11} /></Button>
                            <Button variant={runnerDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "tablet" })} title="Tablet"><Tablet size={11} /></Button>
                            <Button variant={runnerDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setPs({ runnerDevice: "desktop" })} title="Desktop"><Monitor size={11} /></Button>
                          </div>
                          <div className="w-px h-3 bg-border" />
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={zoomOut} title="Zoom out"><Minus size={11} /></Button>
                          <button className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer min-w-[32px] text-center select-none" onClick={zoomReset} title="Reset zoom">{Math.round(runnerZoom * 100)}%</button>
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={zoomIn} title="Zoom in"><Plus size={11} /></Button>
                        </div>
                        <div className="flex-1 overflow-auto p-2 bg-muted/30 flex justify-center">
                          {devUrl ? (
                            <div
                              className="h-full bg-background shadow-lg border border-border overflow-hidden"
                              style={{ width: deviceWidth[runnerDevice], transform: `scale(${runnerZoom})`, transformOrigin: "top center" }}
                            >
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

                {/* Terminal header — always visible, locked height */}
                <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
                  <div className="h-full flex items-center border-b border-border bg-card px-2">
                    <Tabs value={runnerActiveTab} onValueChange={(v) => setPs({ runnerActiveTab: v as "terminal" | "logs" | "network" })}>
                      <TabsList variant="line" className="h-7">
                        <TabsTrigger value="terminal" className="text-[11px] gap-1"><Terminal size={10} />Terminal</TabsTrigger>
                        <TabsTrigger value="logs" className="text-[11px] gap-1"><ScrollText size={10} />Logs</TabsTrigger>
                        <TabsTrigger value="network" className="text-[11px] gap-1"><Globe size={10} />Network</TabsTrigger>
                      </TabsList>
                    </Tabs>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" className="gap-1 h-6 text-[10px] px-1.5" onClick={() => { setShowShellInput((v) => !v); if (!runnerTerminalOpen) setPs({ runnerTerminalOpen: true }); }}>
                      <Terminal size={10} />Shell
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setPs({ runnerTerminalOpen: !runnerTerminalOpen }); }} title={runnerTerminalOpen ? "Collapse terminal" : "Expand terminal"}>
                      {runnerTerminalOpen ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                    </Button>
                  </div>
                </Allotment.Pane>
                {/* Terminal content — shown/hidden via allotment visible prop */}
                <Allotment.Pane visible={runnerTerminalOpen} preferredSize={152} minSize={100}>
                  <div className="h-full flex flex-col">
                    {showShellInput && (
                      <div className="flex gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
                        <span className="text-xs text-muted-foreground self-center">$</span>
                        <Input value={shellCommand} onChange={(e) => setShellCommand(e.target.value)} placeholder="Enter shell command..." className="h-6 text-xs" onKeyDown={(e) => { if (e.key === "Enter") handleNewShell(); if (e.key === "Escape") setShowShellInput(false); }} autoFocus />
                      </div>
                    )}
                    <div className="flex-1 overflow-hidden bg-black text-green-400 font-mono text-xs">
                      {runnerActiveTab === "terminal" && (
                        <div ref={terminalRef} className="h-full overflow-auto p-2 space-y-0.5">
                          {terminalLines.map((item, i) => (
                            <div key={i} className={["break-all whitespace-pre-wrap", item.source === "stderr" ? "text-red-400" : ""].join(" ")}>
                              {item.line}
                            </div>
                          ))}
                          {terminalLines.length === 0 && <div className="opacity-40">No output yet&#8230;</div>}
                        </div>
                      )}
                      {runnerActiveTab === "logs" && (
                        <div className="h-full overflow-auto p-2 space-y-0.5">
                          {terminalLines.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).map((item, i) => (
                            <div key={i} className={["break-all whitespace-pre-wrap", item.line.toLowerCase().includes("error") ? "text-red-400" : item.line.toLowerCase().includes("warning") ? "text-yellow-400" : ""].join(" ")}>
                              {item.line}
                            </div>
                          ))}
                          {terminalLines.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).length === 0 && <div className="opacity-40">No log events yet&#8230;</div>}
                        </div>
                      )}
                      {runnerActiveTab === "network" && (
                        <div className="h-full overflow-auto p-2 space-y-1">
                          {(() => {
                            const requests = terminalLines.map((item) => {
                              const match = item.line.match(/(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
                              if (match) return { method: match[1], path: match[2], status: parseInt(match[3]) };
                              const hmr = item.line.match(/hmr update\s+(\S+)/i);
                              if (hmr) return { method: "HMR", path: hmr[1], status: 0 };
                              return null;
                            }).filter(Boolean) as Array<{ method: string; path: string; status: number }>;
                            if (requests.length === 0) return <div className="opacity-40">No network requests logged yet&#8230;</div>;
                            return requests.map((req, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={["font-bold px-1 py-0.5 rounded", req.status >= 200 && req.status < 300 ? "bg-green-500/20 text-green-400" : req.status >= 400 ? "bg-red-500/20 text-red-400" : req.method === "HMR" ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground"].join(" ")}>{req.method}</span>
                                <span className="truncate flex-1">{req.path}</span>
                                {req.status > 0 && <span className="text-muted-foreground">{req.status}</span>}
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </Allotment.Pane>
              </Allotment>
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      <Dialog open={!!renameTarget} onOpenChange={(o) => !o && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Rename &ldquo;{renameTarget?.name}&rdquo;</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={renameTo} onChange={(e) => setRenameTo(e.target.value)} placeholder="New name..." onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }} autoFocus />
            <Button className="w-full" onClick={handleRename} disabled={!renameTo.trim()}>Rename</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newFolderTarget} onOpenChange={(o) => !o && setNewFolderTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} placeholder="Folder name..." onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }} autoFocus />
            <Button className="w-full" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewFile} onOpenChange={(o) => !o && setShowNewFile(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New File</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input value={newFileName} onChange={(e) => setNewFileName(e.target.value)} placeholder="filename.tsx" onKeyDown={(e) => { if (e.key === "Enter") handleCreateFile(); }} autoFocus />
            <Button className="w-full" onClick={handleCreateFile} disabled={!newFileName.trim()}>Create</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function getAssetType(filePath: string): MentionAsset["type"] | null {
  if (filePath.includes("/components/")) return "component";
  if (filePath.includes("/themes/")) return "theme";
  if (filePath.includes("/screens/")) return "screen";
  return null;
}

interface FileTreeProps {
  entries: FileEntry[];
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onDeleteEntry: (path: string, isDir: boolean) => void;
  onRename: (path: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onCollapse: (path: string) => void;
  onReveal: (path: string) => void;
  depth: number;
  nonce: number;
}

function FileTree({ entries, selectedFile, expandedDirs, onToggleDir, onSelectFile, onDeleteEntry, onRename, onNewFile, onNewFolder, onCollapse, onReveal, depth, nonce }: FileTreeProps) {
  return (
    <>
      {entries.map((file) => (
        <div key={file.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={["group flex items-center gap-1.5 rounded transition-colors cursor-pointer", selectedFile === file.path ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"].join(" ")}
                style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "4px", paddingTop: "2px", paddingBottom: "2px" }}
                draggable={!file.is_dir && getAssetType(file.path) !== null}
                onDragStart={(e) => { const assetType = getAssetType(file.path); if (!file.is_dir && assetType) { e.dataTransfer.setData("application/prototyper-asset", JSON.stringify({ filePath: file.path, assetType, assetName: file.name.replace(/\.(tsx|css)$/, "") })); e.dataTransfer.effectAllowed = "copy"; } }}
                onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}
              >
                {file.is_dir ? <Folder size={12} /> : <FileCode size={12} />}
                <span className="truncate text-xs">{file.name}</span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}>Open</ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(file.path)}>Show in File Explorer</ContextMenuItem>
              {file.is_dir && (<><ContextMenuSeparator /><ContextMenuItem onClick={() => onNewFile(file.path)}>New File&#8230;</ContextMenuItem><ContextMenuItem onClick={() => onNewFolder(file.path)}>New Folder&#8230;</ContextMenuItem>{expandedDirs.has(file.path) && <ContextMenuItem onClick={() => onCollapse(file.path)}>Collapse</ContextMenuItem>}</>)}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onRename(file.path)}>Rename&#8230;</ContextMenuItem>
              <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteEntry(file.path, file.is_dir)}>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {file.is_dir && expandedDirs.has(file.path) && (<AsyncDirChildren path={file.path} selectedFile={selectedFile} expandedDirs={expandedDirs} onToggleDir={onToggleDir} onSelectFile={onSelectFile} onDeleteEntry={onDeleteEntry} onRename={onRename} onNewFile={onNewFile} onNewFolder={onNewFolder} onCollapse={onCollapse} onReveal={onReveal} depth={depth + 1} nonce={nonce} />)}
        </div>
      ))}
    </>
  );
}

function AsyncDirChildren(props: Omit<FileTreeProps, "entries"> & { path: string }) {
  const [children, setChildren] = useState<FileEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try { const entries = await readDir(props.path); if (!cancelled) setChildren(entries); }
      catch { if (!cancelled) setChildren([]); }
    })();
    return () => { cancelled = true; };
  }, [props.path, props.nonce]);
  return <FileTree entries={children} {...props} />;
}