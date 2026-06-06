import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { onTerminalOutput, type TerminalOutputEvent } from "@/lib/ipc";
import type { XTerminalHandle } from "@/components/XTerminal";
import {
  Play, Square, Wrench, Package, PackagePlus, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  readFile, writeFile, deleteFile, renameFile, revealInExplorer,
  bunBuild, bunInstall, killAllProcesses, killPort, runShellCommand,
  isNotFoundError, getErrorMessage,
} from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useUIStore } from "@/stores/uiStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { confirm } from "@tauri-apps/plugin-dialog";
import { notify } from "@/hooks/useToast";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { getGeneratedAppTsx, PROJECT_PATHS as GEN_PATHS } from "@/lib/scaffold-shadcn";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { RenameDialog } from "@/panels/RunnerDialogs";
import { RunnerEditor } from "@/panels/runner/RunnerEditor";
import { RunnerPreview } from "@/panels/runner/RunnerPreview";
import { RunnerTerminalHeader, RunnerTerminalContent } from "@/panels/runner/RunnerTerminal";

export function RunnerPanel() {
  const { settings } = useAppStore();
  const { ps, setProjectSettings } = useProjectSettingsStore();
  const generatedDir = `projects/${settings.project}/generated`;
  const devServerStore = useDevServerStore();
  const running = devServerStore.runnerStatus === "running" || devServerStore.runnerStatus === "starting";
  const devUrl = devServerStore.runnerUrl;
  const runnerDark = ps.runnerDarkPreview;

  const [tabContents, setTabContents] = useState<Record<string, string>>({});
  const [dirtyTabs, setDirtyTabs] = useState<Set<string>>(new Set());
  const xtermRef = useRef<XTerminalHandle>(null);
  const logLinesRef = useRef<Array<{ line: string; source: string }>>([]);
  const [, setLogTick] = useState(0);
  const [isScaffolding, setIsScaffolding] = useState(false);
  const [shellCommand, setShellCommand] = useState("");
  const [showShellInput, setShowShellInput] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ path: string; name: string } | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const { ref: verticalRef, onDragEnd: verticalOnDragEnd, defaultSizes: verticalDefault } = useAllotmentLayout("runner-terminal", 3);
  const { ref: editorRef, onDragEnd: editorOnDragEnd, defaultSizes: editorDefault } = useAllotmentLayout("runner-editor", 2);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeTabPath = ps.runnerEditorActiveTabPath;
  const openTabs = useMemo(() => ps.runnerEditorTabs ?? [], [ps.runnerEditorTabs]);

  // Bump fileTreeRefreshKey so SidebarFilesTab reloads after tab-bar file mutations
  const refreshFiles = useCallback(() => {
    useUIStore.setState((s) => ({ fileTreeRefreshKey: s.fileTreeRefreshKey + 1 }));
  }, []);

  // Open a file requested by the sidebar Files tab
  useEffect(() => {
    const requested = ps.runnerRequestedFile;
    if (!requested) return;
    openTab(requested);
    setProjectSettings({ runnerRequestedFile: null });
    // openTab is defined below and stable; including it would create a circular dep
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ps.runnerRequestedFile]);

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

  const reorderTabs = useCallback((newOrder: string[]) => {
    setProjectSettings({ runnerEditorTabs: newOrder });
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

  // ── File operations (from editor tab bar) ──────────────────────────────

  const handleDeleteFile = async (path: string) => {
    if (!(await confirm(`Delete ${path.split("/").pop()}?`))) return;
    await deleteFile(path);
    if (openTabs.includes(path)) closeTab(path);
    refreshFiles();
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
        <Allotment vertical ref={verticalRef} onDragEnd={verticalOnDragEnd} defaultSizes={verticalDefault} className="h-full" onVisibleChange={(_i, v) => setProjectSettings({ runnerTerminalOpen: v })}>
          <Allotment.Pane>
            <Allotment ref={editorRef} onDragEnd={editorOnDragEnd} defaultSizes={editorDefault}>
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
                  reorderTabs={reorderTabs}
                />
              </Allotment.Pane>

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

          {/* Terminal header — 28px locked pane, always visible.
              Allotment.Pane must be a direct JSX child (not inside a fragment
              from a sub-component) so Allotment correctly tracks visible changes. */}
          <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
            <RunnerTerminalHeader
              runnerActiveTab={ps.runnerActiveTab}
              runnerTerminalOpen={ps.runnerTerminalOpen}
              setShowShellInput={setShowShellInput}
              setProjectSettings={setProjectSettings}
            />
          </Allotment.Pane>

          <Allotment.Pane visible={ps.runnerTerminalOpen} preferredSize={200} minSize={100} snap>
            {ps.runnerTerminalOpen && (
              <RunnerTerminalContent
                xtermRef={xtermRef}
                runnerActiveTab={ps.runnerActiveTab}
                showShellInput={showShellInput}
                shellCommand={shellCommand}
                logLinesRef={logLinesRef}
                setShowShellInput={setShowShellInput}
                setShellCommand={setShellCommand}
                handleNewShell={handleNewShell}
              />
            )}
          </Allotment.Pane>
        </Allotment>
      </div>

      <RenameDialog target={renameTarget} value={renameTo} onChange={setRenameTo} onConfirm={handleRename} onClose={() => setRenameTarget(null)} />
    </div>
  );
}
