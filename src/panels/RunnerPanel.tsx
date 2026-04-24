import { useState, useEffect, useCallback, useRef } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import { onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import {
  Play,
  Square,
  Wrench,
  Package,
  RotateCw,
  Maximize2,
  Smartphone,
  Tablet,
  Monitor,
  Folder,
  FileCode,
  Terminal,
  ScrollText,
  Globe,
  Plus,

  ChevronDown,
  ChevronUp,
  Save,
  FolderPlus,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
  bunDev,
  bunBuild,
  bunInstall,
  killProcess,
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
import { confirm } from "@tauri-apps/plugin-dialog";
import { notify } from "@/hooks/useToast";

export function RunnerPanel() {
  const { settings } = useAppStore();
  const generatedDir = `projects/${settings.project}/generated`;

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [terminalLines, setTerminalLines] = useState<Array<{ line: string; source: string }>>([]);
  const [running, setRunning] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [newFileParentDir, setNewFileParentDir] = useState<string>(generatedDir);
  const [shellCommand, setShellCommand] = useState("");
  const [showShellInput, setShowShellInput] = useState(false);
  const [fitPreview, setFitPreview] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [activeTerminalTab, setActiveTerminalTab] = useState("terminal");
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [newFolderTarget, setNewFolderTarget] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const verticalAllotmentRef = useRef<AllotmentHandle>(null);
  const pidRef = useRef<number | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const entries = await readDir(generatedDir);
      setFiles(entries);
    } catch {
      setFiles([]);
    }
  }, [generatedDir]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    const unlistenPromise = onTerminalOutput((event: TerminalOutputEvent) => {
      setTerminalLines((prev) => [...prev, { line: event.line, source: event.source }]);
      if (event.line.includes("Local:")) {
        setPreviewReady(true);
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
    try {
      const content = await readFile(path);
      setFileContent(content);
    } catch {
      setFileContent("");
    }
  };

  const handleSaveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      await writeFile(selectedFile, fileContent);
    } catch (e) {
      notify.error("Save failed", e instanceof Error ? e.message : String(e));
    }
  }, [selectedFile, fileContent]);

  const handleEditorBlur = useCallback(() => {
    handleSaveFile();
  }, [handleSaveFile]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSaveFile]);

  // HMR: detect file update events from dev server terminal output and refresh iframe
  useEffect(() => {
    const unlistenPromise = onTerminalOutput((event: TerminalOutputEvent) => {
      if (running && iframeRef.current && (event.line.includes("updated") || event.line.includes("hmr") || event.line.includes("HMR"))) {
        iframeRef.current.src = iframeRef.current.src;
      }
    });
    return () => { unlistenPromise.then((fn) => fn()); };
  }, [running]);

  const handleRun = async () => {
    if (running && pidRef.current) {
      try {
        await killProcess(pidRef.current);
      } catch (e) {
        notify.error("Failed to stop process", e instanceof Error ? e.message : String(e));
      }
      pidRef.current = null;
      setRunning(false);
      setPreviewReady(false);
      return;
    }
    setTerminalLines((prev) => [...prev, { line: "> bun dev", source: "stdout" }]);
    setRunning(true);
    setPreviewReady(false);
    try {
      const pid = await bunDev(generatedDir, 5173);
      pidRef.current = pid;
    } catch (e) {
      setRunning(false);
      notify.error("Failed to start dev server", e instanceof Error ? e.message : String(e));
    }
  };

  const handleBuild = async () => {
    setTerminalLines((prev) => [...prev, { line: "> bun build", source: "stdout" }]);
    try {
      const pid = await bunBuild(generatedDir);
      pidRef.current = pid;
    } catch (e) {
      notify.error("Build failed", e instanceof Error ? e.message : String(e));
    }
  };

  const handleInstall = async () => {
    setTerminalLines((prev) => [...prev, { line: "> bun install", source: "stdout" }]);
    try {
      const pid = await bunInstall(generatedDir);
      pidRef.current = pid;
    } catch (e) {
      notify.error("Install failed", e instanceof Error ? e.message : String(e));
    }
  };

  const deviceScale = {
    desktop: 1,
    tablet: 0.75,
    mobile: 0.4,
  };

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        loadFiles();
      }
      return next;
    });
  };

  const handleDeleteFile = async (path: string) => {
    if (!(await confirm(`Delete ${path.split("/").pop()}?`))) return;
    await deleteFile(path);
    if (selectedFile === path) {
      setSelectedFile(null);
      setFileContent("");
    }
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
    if (selectedFile?.startsWith(path)) {
      setSelectedFile(null);
      setFileContent("");
    }
    expandedDirs.delete(path);
    loadFiles();
  };

  const handleDeleteEntry = async (path: string, isDir: boolean) => {
    if (isDir) {
      await handleDeleteDir(path);
    } else {
      await handleDeleteFile(path);
    }
  };

  const startRename = (path: string) => {
    const name = path.split("/").pop() || "";
    setRenameTarget({ path, name });
    setRenameTo(name);
  };

  const handleRename = async () => {
    if (!renameTarget || !renameTo.trim()) return;
    const dir = renameTarget.path.substring(0, renameTarget.path.lastIndexOf("/"));
    const newPath = `${dir}/${renameTo.trim()}`;
    try {
      await renameFile(renameTarget.path, newPath);
      if (selectedFile === renameTarget.path) {
        setSelectedFile(newPath);
      }
      loadFiles();
    } catch (e) {
      notify.error("Rename failed", e instanceof Error ? e.message : String(e));
    }
    setRenameTarget(null);
  };

  const startNewFolder = (parentPath: string) => {
    setNewFolderTarget(parentPath);
    setNewFolderName("");
  };

  const handleCreateFolder = async () => {
    if (!newFolderTarget || !newFolderName.trim()) return;
    const path = `${newFolderTarget}/${newFolderName.trim()}`;
    try {
      await createDir(path);
      expandedDirs.add(newFolderTarget);
      loadFiles();
    } catch (e) {
      notify.error("Create folder failed", e instanceof Error ? e.message : String(e));
    }
    setNewFolderTarget(null);
  };

  const handleNewFileInDir = (parentPath: string) => {
    setNewFileParentDir(parentPath);
    setNewFileName("");
    setShowNewFile(true);
  };

  const collapseAll = () => {
    setExpandedDirs(new Set());
  };

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
    pidRef.current = pid;
    setShellCommand("");
    setShowShellInput(false);
  };

  const handleRefreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  };

  const handleFitPreview = () => {
    setFitPreview((prev) => !prev);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
        <Button
          variant={running ? "destructive" : "default"}
          size="sm"
          className="gap-1 h-7 text-xs"
          onClick={handleRun}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? "Stop" : "Run"}
        </Button>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={handleBuild}>
          <Wrench size={12} />
          Build
        </Button>
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={handleInstall}>
          <Package size={12} />
          Install
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefreshPreview}>
          <RotateCw size={12} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleFitPreview}>
          <Maximize2 size={12} />
        </Button>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <Button
            variant={device === "mobile" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setDevice("mobile")}
          >
            <Smartphone size={12} />
          </Button>
          <Button
            variant={device === "tablet" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setDevice("tablet")}
          >
            <Tablet size={12} />
          </Button>
          <Button
            variant={device === "desktop" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => setDevice("desktop")}
          >
            <Monitor size={12} />
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-hidden">
        <Allotment>
          {/* File Tree */}
          <Allotment.Pane preferredSize={200} minSize={150}>
            <div className="h-full overflow-auto p-2 bg-card border-r border-border">
              <div className="flex items-center justify-between mb-2 px-1">
                <ContextMenu>
                  <ContextMenuTrigger asChild>
                    <span className="text-xs font-medium text-muted-foreground cursor-default">Files</span>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}>
                      <Plus size={12} className="mr-2" /> New File…
                    </ContextMenuItem>
                    <ContextMenuItem onClick={() => startNewFolder(generatedDir)}>
                      <FolderPlus size={12} className="mr-2" /> New Folder…
                    </ContextMenuItem>
                    <ContextMenuItem onClick={collapseAll}>
                      Collapse All
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => revealInExplorer(generatedDir)}>
                      Show in File Explorer
                    </ContextMenuItem>
                    <ContextMenuItem onClick={loadFiles}>
                      <RefreshCw size={12} className="mr-2" /> Refresh
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                <div className="flex gap-0.5">
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => startNewFolder(generatedDir)}>
                    <FolderPlus size={10} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => { setNewFileParentDir(generatedDir); setShowNewFile(true); }}>
                    <Plus size={10} />
                  </Button>
                </div>
              </div>
              {files.length === 0 && (
                <div className="text-xs text-muted-foreground px-1">No files yet</div>
              )}
              <FileTree
                entries={files}
                selectedFile={selectedFile}
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
                onSelectFile={handleSelectFile}
                onDeleteEntry={handleDeleteEntry}
                onRename={startRename}
                onNewFile={handleNewFileInDir}
                onNewFolder={startNewFolder}
                onCollapse={(path) => { expandedDirs.delete(path); setExpandedDirs(new Set(expandedDirs)); }}
                onReveal={(path) => revealInExplorer(path)}
                depth={0}
              />
            </div>
          </Allotment.Pane>

          {/* Editor + Preview side by side */}
          <Allotment.Pane>
            <div className="h-full flex flex-col">
            <Allotment vertical ref={verticalAllotmentRef} className="flex-1 min-h-0" >
              <Allotment.Pane>
                <Allotment>
                  {/* Editor */}
                  <Allotment.Pane minSize={200}>
                    {selectedFile ? (
                      <div className="h-full flex flex-col">
                        <div className="h-8 border-b border-border flex items-center px-3 gap-2 bg-card shrink-0">
                          <span className="text-xs font-medium">{selectedFile.split("/").pop()}</span>
                          <div className="flex-1" />
                          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveFile}>
                            <Save size={14} />
                          </Button>
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <CodeMirrorEditor
                            value={fileContent}
                            onChange={setFileContent}
                            onBlur={handleEditorBlur}
                            mode={getFileMode(selectedFile)}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground text-sm p-4">
                        Select a file to edit
                      </div>
                    )}
                  </Allotment.Pane>

                  {/* Preview */}
                  <Allotment.Pane minSize={300}>
                    <div className="h-full flex flex-col">
                      <div className="h-8 border-b border-border flex items-center px-3 bg-card shrink-0">
                        <span className="text-xs font-medium">Preview</span>
                      </div>
                      <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                        {previewReady ? (
                          <div
                            className="h-full bg-background shadow-lg border border-border overflow-hidden"
                            style={{ width: deviceWidth[device], transform: fitPreview ? "none" : `scale(${deviceScale[device]})`, transformOrigin: "top center" }}
                          >
                            <iframe
                              ref={iframeRef}
                              src="http://localhost:5173"
                              className="w-full h-full"
                              sandbox="allow-scripts allow-same-origin allow-forms"
                              style={fitPreview ? { width: "100%", height: "100%" } : undefined}
                            />
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

              {/* Terminal / Logs / Network */}
              <Allotment.Pane preferredSize={180} minSize={28}>
                <div className="h-full flex flex-col">
                  {/* Tab bar — always visible */}
                  <div className="flex items-center border-b border-border shrink-0 bg-card h-7">
                    <div className="flex h-7">
                      {(["terminal", "logs", "network"] as const).map((tab) => (
                        <button
                          key={tab}
                          onClick={() => setActiveTerminalTab(tab)}
                          className={["flex items-center gap-1 px-3 h-7 text-[10px] border-r border-border transition-colors", activeTerminalTab === tab ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"].join(" ")}
                        >
                          {tab === "terminal" && <Terminal size={10} />}
                          {tab === "logs" && <ScrollText size={10} />}
                          {tab === "network" && <Globe size={10} />}
                          {tab.charAt(0).toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1" />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1 h-7 text-[10px] px-2"
                      onClick={() => {
                        setShowShellInput((v) => !v);
                        if (!terminalOpen) {
                          setTerminalOpen(true);
                          verticalAllotmentRef.current?.resize([9999, 180]);
                        }
                      }}
                    >
                      <Terminal size={10} />
                      Shell
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => {
                        if (terminalOpen) {
                          verticalAllotmentRef.current?.resize([9999, 28]);
                          setTerminalOpen(false);
                        } else {
                          verticalAllotmentRef.current?.resize([9999, 180]);
                          setTerminalOpen(true);
                        }
                      }}
                      title={terminalOpen ? "Collapse terminal" : "Expand terminal"}
                    >
                      {terminalOpen ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
                    </Button>
                  </div>

                  {/* Shell input */}
                  {showShellInput && (
                    <div className="flex gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
                      <span className="text-xs text-muted-foreground self-center">$</span>
                      <Input
                        value={shellCommand}
                        onChange={(e) => setShellCommand(e.target.value)}
                        placeholder="Enter shell command..."
                        className="h-6 text-xs"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleNewShell();
                          if (e.key === "Escape") setShowShellInput(false);
                        }}
                        autoFocus
                      />
                    </div>
                  )}

                  {/* Terminal content */}
                  <div className="flex-1 overflow-hidden bg-black text-green-400 font-mono text-xs">
                    {activeTerminalTab === "terminal" && (
                      <div ref={terminalRef} className="h-full overflow-auto p-2 space-y-0.5">
                        {terminalLines.map((item, i) => (
                          <div key={i} className={["break-all whitespace-pre-wrap", item.source === "stderr" ? "text-red-400" : ""].join(" ")}>
                            {item.line}
                          </div>
                        ))}
                        {terminalLines.length === 0 && <div className="opacity-40">No output yet…</div>}
                      </div>
                    )}
                    {activeTerminalTab === "logs" && (
                      <div className="h-full overflow-auto p-2 space-y-0.5">
                        {terminalLines.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).map((item, i) => (
                          <div key={i} className={["break-all whitespace-pre-wrap", item.line.toLowerCase().includes("error") ? "text-red-400" : item.line.toLowerCase().includes("warning") ? "text-yellow-400" : ""].join(" ")}>
                            {item.line}
                          </div>
                        ))}
                        {terminalLines.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).length === 0 && <div className="opacity-40">No log events yet…</div>}
                      </div>
                    )}
                    {activeTerminalTab === "network" && (
                      <div className="h-full overflow-auto p-2 space-y-1">
                        {(() => {
                          const requests = terminalLines.map((item) => {
                            const match = item.line.match(/(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
                            if (match) return { method: match[1], path: match[2], status: parseInt(match[3]) };
                            const hmr = item.line.match(/hmr update\s+(\S+)/i);
                            if (hmr) return { method: "HMR", path: hmr[1], status: 0 };
                            return null;
                          }).filter(Boolean) as Array<{ method: string; path: string; status: number }>;
                          if (requests.length === 0) return <div className="opacity-40">No network requests logged yet…</div>;
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
          <DialogHeader>
            <DialogTitle>Rename "{renameTarget?.name}"</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              placeholder="New name..."
              onKeyDown={(e) => { if (e.key === "Enter") handleRename(); }}
              autoFocus
            />
            <Button className="w-full" onClick={handleRename} disabled={!renameTo.trim()}>
              Rename
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newFolderTarget} onOpenChange={(o) => !o && setNewFolderTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name..."
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
              autoFocus
            />
            <Button className="w-full" onClick={handleCreateFolder} disabled={!newFolderName.trim()}>
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewFile} onOpenChange={(o) => !o && setShowNewFile(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New File</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              placeholder="filename.tsx"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFile(); }}
              autoFocus
            />
            <Button className="w-full" onClick={handleCreateFile} disabled={!newFileName.trim()}>
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
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
}

function FileTree({ entries, selectedFile, expandedDirs, onToggleDir, onSelectFile, onDeleteEntry, onRename, onNewFile, onNewFolder, onCollapse, onReveal, depth }: FileTreeProps) {
  return (
    <>
      {entries.map((file) => (
        <div key={file.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={[
                  "group flex items-center gap-1.5 rounded transition-colors cursor-pointer",
                  selectedFile === file.path
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                ].join(" ")}
                style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "4px", paddingTop: "2px", paddingBottom: "2px" }}
                onClick={() => {
                  if (file.is_dir) onToggleDir(file.path);
                  else onSelectFile(file.path);
                }}
              >
                {file.is_dir ? <Folder size={12} /> : <FileCode size={12} />}
                <span className="truncate text-xs">{file.name}</span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}>
                Open
              </ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(file.path)}>
                Show in File Explorer
              </ContextMenuItem>
              {file.is_dir && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onNewFile(file.path)}>
                    New File…
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => onNewFolder(file.path)}>
                    New Folder…
                  </ContextMenuItem>
                  {expandedDirs.has(file.path) && (
                    <ContextMenuItem onClick={() => onCollapse(file.path)}>
                      Collapse
                    </ContextMenuItem>
                  )}
                </>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onRename(file.path)}>
                Rename…
              </ContextMenuItem>
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => onDeleteEntry(file.path, file.is_dir)}
              >
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {file.is_dir && expandedDirs.has(file.path) && (
            <AsyncDirChildren
              path={file.path}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              onDeleteEntry={onDeleteEntry}
              onRename={onRename}
              onNewFile={onNewFile}
              onNewFolder={onNewFolder}
              onCollapse={onCollapse}
              onReveal={onReveal}
              depth={depth + 1}
            />
          )}
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
      try {
        const entries = await readDir(props.path);
        if (!cancelled) setChildren(entries);
      } catch {
        if (!cancelled) setChildren([]);
      }
    })();
    return () => { cancelled = true; };
  }, [props.path]);
  return <FileTree entries={children} {...props} />;
}