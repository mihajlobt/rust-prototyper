import { useState, useEffect, useCallback, useRef } from "react";
import { Allotment } from "allotment";
import { listen } from "@tauri-apps/api/event";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

const GENERATED_DIR = "./generated";

export function RunnerPanel() {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [newFileName, setNewFileName] = useState("");
  const [showNewFile, setShowNewFile] = useState(false);
  const [shellCommand, setShellCommand] = useState("");
  const [showShellInput, setShowShellInput] = useState(false);
  const [fitPreview, setFitPreview] = useState(false);
  const pidRef = useRef<number | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const loadFiles = useCallback(async () => {
    try {
      const entries = await readDir(GENERATED_DIR);
      setFiles(entries);
    } catch {
      setFiles([]);
    }
  }, []);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await listen("terminal-output", (e) => {
        const payload = e.payload as { line: string };
        setTerminalLines((prev) => [...prev, payload.line]);
        if (payload.line.includes("Local:")) {
          setPreviewReady(true);
        }
      });
    })();
    return () => unlisten?.();
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

  const handleSaveFile = async () => {
    if (!selectedFile) return;
    await writeFile(selectedFile, fileContent);
  };

  const handleRun = async () => {
    if (running && pidRef.current) {
      await killProcess(pidRef.current);
      pidRef.current = null;
      setRunning(false);
      setPreviewReady(false);
      return;
    }
    setTerminalLines((prev) => [...prev, "> bun dev"]);
    setRunning(true);
    setPreviewReady(false);
    const pid = await bunDev(GENERATED_DIR, 5173);
    pidRef.current = pid;
  };

  const handleBuild = async () => {
    setTerminalLines((prev) => [...prev, "> bun build"]);
    const pid = await bunBuild(GENERATED_DIR);
    pidRef.current = pid;
  };

  const handleInstall = async () => {
    setTerminalLines((prev) => [...prev, "> bun install"]);
    const pid = await bunInstall(GENERATED_DIR);
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
    const path = `${GENERATED_DIR}/${newFileName.trim()}`;
    await writeFile(path, "");
    setNewFileName("");
    setShowNewFile(false);
    loadFiles();
    handleSelectFile(path);
  };

  // Keyboard shortcut: Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSaveFile();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedFile, fileContent]);

  const getFileMode = (path: string): "tsx" | "css" | "json" | "javascript" => {
    if (path.endsWith(".css")) return "css";
    if (path.endsWith(".json")) return "json";
    if (path.endsWith(".tsx") || path.endsWith(".jsx")) return "tsx";
    return "javascript";
  };

  const handleNewShell = async () => {
    if (!shellCommand.trim()) return;
    setTerminalLines((prev) => [...prev, `> ${shellCommand}`]);
    const pid = await runShellCommand(GENERATED_DIR, shellCommand);
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
        <Button variant="outline" size="sm" className="gap-1 h-7 text-xs" onClick={() => setShowShellInput(!showShellInput)}>
          <Terminal size={12} />
          Shell
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

          {/* Editor + Terminal / Preview */}
          <Allotment.Pane>
            <Allotment vertical>
              <Allotment.Pane>
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
                        mode={getFileMode(selectedFile)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    {previewReady ? (
                      <div className="w-full h-full flex items-center justify-center bg-muted/30 p-4">
                        <div
                          className="h-full bg-background shadow-lg border border-border overflow-hidden"
                          style={{ width: deviceWidth[device], transform: `scale(${deviceScale[device]})`, transformOrigin: "top center" }}
                        >
                          <iframe
                            ref={iframeRef}
                            src="http://localhost:5173"
                            className="w-full h-full"
                            sandbox="allow-scripts allow-same-origin allow-forms"
                            style={fitPreview ? { width: "100%", height: "100%" } : undefined}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Play size={32} className="mx-auto mb-3 opacity-30" />
                        <p>Click Run to start the dev server</p>
                        <p className="text-xs opacity-50 mt-1">Preview will appear here</p>
                      </div>
                    )}
                  </div>
                )}
              </Allotment.Pane>

              {/* Terminal / Logs / Network */}
              <Allotment.Pane preferredSize={160} minSize={80}>
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
                <Tabs defaultValue="terminal" className="h-full flex flex-col">
                  <TabsList className="grid w-full grid-cols-3 shrink-0 h-7">
                    <TabsTrigger value="terminal" className="text-[10px] gap-1">
                      <Terminal size={10} />
                      Terminal
                    </TabsTrigger>
                    <TabsTrigger value="logs" className="text-[10px] gap-1">
                      <ScrollText size={10} />
                      Logs
                    </TabsTrigger>
                    <TabsTrigger value="network" className="text-[10px] gap-1">
                      <Globe size={10} />
                      Network
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="terminal" className="flex-1 overflow-hidden mt-0">
                    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs">
                      <div ref={terminalRef} className="flex-1 overflow-auto p-2 space-y-0.5">
                        {terminalLines.map((line, i) => (
                          <div key={i} className="break-all whitespace-pre-wrap">
                            {line}
                          </div>
                        ))}
                        {terminalLines.length === 0 && (
                          <div className="opacity-40">No output yet…</div>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="logs" className="flex-1 overflow-hidden mt-0">
                    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs">
                      <div className="flex-1 overflow-auto p-2 space-y-0.5">
                        {terminalLines
                          .filter(
                            (line) =>
                              line.includes("error") ||
                              line.includes("warning") ||
                              line.includes("hmr") ||
                              line.includes("Hot") ||
                              line.includes("build") ||
                              line.includes("ready")
                          )
                          .map((line, i) => (
                            <div
                              key={i}
                              className={[
                                "break-all whitespace-pre-wrap",
                                line.toLowerCase().includes("error")
                                  ? "text-red-400"
                                  : line.toLowerCase().includes("warning")
                                  ? "text-yellow-400"
                                  : "",
                              ].join(" ")}
                            >
                              {line}
                            </div>
                          ))}
                        {terminalLines.filter((l) =>
                          /error|warning|hmr|hot|build|ready/i.test(l)
                        ).length === 0 && (
                          <div className="opacity-40">No log events yet…</div>
                        )}
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="network" className="flex-1 overflow-hidden mt-0">
                    <div className="h-full flex flex-col bg-black text-green-400 font-mono text-xs">
                      <div className="flex-1 overflow-auto p-2">
                        <div className="opacity-40">Network interception requires preview devtools integration.</div>
                        <div className="mt-2 opacity-60">Tip: Open the preview in your browser devtools to inspect network requests.</div>
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
              </Allotment.Pane>
            </Allotment>
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
