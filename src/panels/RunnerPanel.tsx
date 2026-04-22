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
  Trash2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import {
  readDir,
  readFile,
  writeFile,
  bunDev,
  bunBuild,
  bunInstall,
  killProcess,
  runShellCommand,
  type FileEntry,
} from "@/lib/ipc";
import { Input } from "@/components/ui/input";
import { deleteFile } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

export function RunnerPanel() {
  const { settings } = useSettings();
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
  const [shellCommand, setShellCommand] = useState("");
  const [showShellInput, setShowShellInput] = useState(false);
  const [fitPreview, setFitPreview] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [activeTerminalTab, setActiveTerminalTab] = useState("terminal");
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
    await writeFile(selectedFile, fileContent);
  }, [selectedFile, fileContent]);

  const handleEditorBlur = useCallback(() => {
    handleSaveFile();
  }, [handleSaveFile]);

  // Ctrl+S keyboard shortcut
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
      await killProcess(pidRef.current);
      pidRef.current = null;
      setRunning(false);
      setPreviewReady(false);
      return;
    }
    setTerminalLines((prev) => [...prev, { line: "> bun dev", source: "stdout" }]);
    setRunning(true);
    setPreviewReady(false);
    const pid = await bunDev(generatedDir, 5173);
    pidRef.current = pid;
  };

  const handleBuild = async () => {
    setTerminalLines((prev) => [...prev, { line: "> bun build", source: "stdout" }]);
    const pid = await bunBuild(generatedDir);
    pidRef.current = pid;
  };

  const handleInstall = async () => {
    setTerminalLines((prev) => [...prev, { line: "> bun install", source: "stdout" }]);
    const pid = await bunInstall(generatedDir);
    pidRef.current = pid;
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
    if (!confirm(`Delete ${path.split("/").pop()}?`)) return;
    await deleteFile(path);
    if (selectedFile === path) {
      setSelectedFile(null);
      setFileContent("");
    }
    loadFiles();
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    const path = `${generatedDir}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName("");
    setShowNewFile(false);
    loadFiles();
    handleSelectFile(path);
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
                <span className="text-xs font-medium text-muted-foreground">Files</span>
                <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowNewFile(true)}>
                  <Plus size={10} />
                </Button>
              </div>
              {showNewFile && (
                <div className="flex gap-1 mb-2">
                  <Input
                    value={newFileName}
                    onChange={(e) => setNewFileName(e.target.value)}
                    placeholder="filename.ts"
                    className="h-6 text-xs"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreateFile();
                      if (e.key === "Escape") setShowNewFile(false);
                    }}
                    autoFocus
                  />
                </div>
              )}
              {files.length === 0 && (
                <div className="text-xs text-muted-foreground px-1">No files yet</div>
              )}
              <FileTree
                entries={files}
                selectedFile={selectedFile}
                expandedDirs={expandedDirs}
                onToggleDir={toggleDir}
                onSelectFile={handleSelectFile}
                onDeleteFile={handleDeleteFile}
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
                          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={handleSaveFile}>
                            Save
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
    </div>
  );
}

interface FileTreeProps {
  entries: FileEntry[];
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onDeleteFile: (path: string) => void;
  depth: number;
}

function FileTree({ entries, selectedFile, expandedDirs, onToggleDir, onSelectFile, onDeleteFile, depth }: FileTreeProps) {
  return (
    <>
      {entries.map((file) => (
        <div key={file.path}>
          <div
            className={[
              "group flex items-center gap-1.5 rounded transition-colors",
              selectedFile === file.path
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ].join(" ")}
            style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "4px", paddingTop: "2px", paddingBottom: "2px" }}
          >
            <button
              className="flex items-center gap-1.5 flex-1 text-left text-xs"
              onClick={() => {
                if (file.is_dir) {
                  onToggleDir(file.path);
                } else {
                  onSelectFile(file.path);
                }
              }}
            >
              {file.is_dir ? <Folder size={12} /> : <FileCode size={12} />}
              <span className="truncate">{file.name}</span>
            </button>
            {!file.is_dir && (
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteFile(file.path);
                }}
              >
                <Trash2 size={8} className="text-red-500" />
              </Button>
            )}
          </div>
          {file.is_dir && expandedDirs.has(file.path) && (
            <AsyncDirChildren
              path={file.path}
              selectedFile={selectedFile}
              expandedDirs={expandedDirs}
              onToggleDir={onToggleDir}
              onSelectFile={onSelectFile}
              onDeleteFile={onDeleteFile}
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