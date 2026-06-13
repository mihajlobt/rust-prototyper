import { useState, useRef, useCallback } from "react";
import { X, FileCode, Save, FileDiff, Rows3, Columns2, XCircle } from "lucide-react";
import type { MouseEvent } from "react";
import type { EditorView } from "@codemirror/view";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { showContextMenu, createTabActions, createDiffTabActions } from "@/lib/context-menu";
import { gitGutterExtension } from "@/lib/git/gutter";
import { isDiffTab, MAIN_DIFF_TAB_ID } from "@/lib/git/diffTabs";
import { DiffAccordionView } from "@/panels/runner/DiffAccordionView";
import { useAppStore } from "@/stores/appStore";
import type { DiffViewMode } from "@/lib/git/types";

export interface RunnerEditorProps {
  openTabs: string[];
  activeTabPath: string | null;
  tabContents: Record<string, string>;
  dirtyTabs: Set<string>;
  openDiffs: string[];
  diffViewMode: DiffViewMode;
  onDiffViewModeChange: (mode: DiffViewMode) => void;
  onCloseDiff: (diffId: string) => void;
  onCloseAllDiffs: () => void;
  openTab: (path: string) => void;
  closeTab: (path: string, e?: MouseEvent) => void;
  closeOtherTabs: (path: string) => void;
  closeTabsToRight: (path: string) => void;
  closeAllTabs: () => void;
  handleSaveFile: () => void;
  handleContentChange: (content: string) => void;
  handleEditorBlur: () => void;
  startRename: (path: string) => void;
  handleDeleteFile: (path: string) => void;
  revealInExplorer: (path: string) => void;
  reorderTabs: (newOrder: string[]) => void;
  /** Receives the underlying CodeMirror EditorView so RunnerPanel can dispatch git gutter updates. */
  editorViewRef?: React.MutableRefObject<EditorView | null>;
}

/** Tab bar + CodeMirror editor body for the Runner panel.
 *  All state and persistence lives in RunnerPanel — this component is a pure view
 *  over the tab list and dirty flags, with handler callbacks bubbled up. */
export function RunnerEditor({
  openTabs,
  activeTabPath,
  tabContents,
  dirtyTabs,
  openDiffs,
  diffViewMode,
  onDiffViewModeChange,
  onCloseDiff,
  onCloseAllDiffs,
  openTab,
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  handleSaveFile,
  handleContentChange,
  handleEditorBlur,
  startRename,
  handleDeleteFile,
  revealInExplorer,
  reorderTabs,
  editorViewRef,
}: RunnerEditorProps) {
  const { settings } = useAppStore();
  // State for the opacity effect only — not read in drag handlers (would be stale)
  const [dragFromPath, setDragFromPath] = useState<string | null>(null);
  // Refs ensure drag handlers always read the latest values without stale closures
  const dragFromPathRef = useRef<string | null>(null);
  const openTabsRef = useRef(openTabs);
  openTabsRef.current = openTabs;
  const tabBarRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const insertBeforeRef = useRef<number | null>(null);

  const showIndicator = (x: number) => {
    if (!indicatorRef.current) return;
    indicatorRef.current.style.display = "block";
    indicatorRef.current.style.left = `${x}px`;
  };

  const hideIndicator = () => {
    if (indicatorRef.current) indicatorRef.current.style.display = "none";
    insertBeforeRef.current = null;
  };

  const handleDragStart = useCallback((path: string, name: string, e: React.DragEvent) => {
    dragFromPathRef.current = path;
    setDragFromPath(path); // triggers re-render for opacity effect
    e.dataTransfer.setData("text/plain", path);
    e.dataTransfer.effectAllowed = "move";

    // Custom ghost: a pill showing just the filename, styled with current theme tokens.
    // Appended off-screen; browser captures the image synchronously before next frame removes it.
    const ghost = document.createElement("div");
    ghost.textContent = name;
    Object.assign(ghost.style, {
      position: "fixed",
      top: "-9999px",
      left: "-9999px",
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 10px",
      background: "var(--card)",
      color: "var(--foreground)",
      border: "1px solid var(--border)",
      borderRadius: "6px",
      fontSize: "11px",
      fontFamily: "inherit",
      fontWeight: "500",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      boxShadow: "0 4px 12px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.2)",
      backdropFilter: "blur(8px)",
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, ghost.offsetWidth / 2, 14);
    requestAnimationFrame(() => document.body.removeChild(ghost));
  }, []);

  const handleDragOver = useCallback((tabIndex: number, e: React.DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";

    if (!tabBarRef.current || !indicatorRef.current) return;
    const tabRect = e.currentTarget.getBoundingClientRect();
    const barRect = tabBarRef.current.getBoundingClientRect();
    const isLeftHalf = e.clientX < tabRect.left + tabRect.width / 2;

    insertBeforeRef.current = isLeftHalf ? tabIndex : tabIndex + 1;

    const rawX = isLeftHalf ? tabRect.left - barRect.left : tabRect.right - barRect.left;
    showIndicator(rawX + tabBarRef.current.scrollLeft);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    // Read refs immediately — avoids stale closure from React state
    const fromPath = dragFromPathRef.current;
    const insertBefore = insertBeforeRef.current;
    // Clear before any early return so a second fire (bubble) is a no-op
    dragFromPathRef.current = null;
    hideIndicator();
    setDragFromPath(null);

    if (!fromPath || insertBefore === null) return;

    const tabs = openTabsRef.current;
    const fromIndex = tabs.indexOf(fromPath);
    if (fromIndex === -1) return;

    const withoutDragged = tabs.filter((p) => p !== fromPath);
    const insertAt = insertBefore > fromIndex ? insertBefore - 1 : insertBefore;
    withoutDragged.splice(insertAt, 0, fromPath);
    reorderTabs(withoutDragged);
  }, [reorderTabs]);

  const handleDragEnd = useCallback(() => {
    dragFromPathRef.current = null;
    hideIndicator();
    setDragFromPath(null);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {openTabs.length > 0 && (
        <div className="flex items-stretch border-b border-border bg-card shrink-0" style={{ height: 32 }}>
          <div
            ref={tabBarRef}
            className="relative flex items-stretch overflow-x-auto flex-1 min-w-0"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {/* Drop indicator — absolute div mutated directly, zero React re-renders during drag */}
            <div
              ref={indicatorRef}
              style={{ display: "none", left: 0 }}
              className="absolute top-0.5 bottom-0.5 w-0.5 bg-primary rounded-full pointer-events-none z-10"
            />

            {openTabs.map((path, tabIndex) => {
              const isDiff = isDiffTab(path);
              const name = isDiff ? "Changes" : path.split("/").pop() ?? path;
              const isActive = path === activeTabPath;
              const isDirty = dirtyTabs.has(path);
              const isLast = tabIndex === openTabs.length - 1;
              const isBeingDragged = path === dragFromPath;

              return (
                <button
                  key={path}
                  draggable
                  onDragStart={(e) => handleDragStart(path, name, e)}
                  onDragOver={(e) => handleDragOver(tabIndex, e)}
                  onDragEnd={handleDragEnd}
                  onClick={() => openTab(path)}
                  onAuxClick={(e) => { if (e.button === 1) closeTab(path, e); }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (isDiff) {
                      showContextMenu(
                        createDiffTabActions({
                          onClose: () => closeTab(path),
                          onCloseOthers: () => closeOtherTabs(path),
                          onCloseToRight: () => closeTabsToRight(path),
                          onCloseAll: closeAllTabs,
                          canCloseOthers: openTabs.length > 1,
                          canCloseToRight: !isLast,
                        }),
                        e.clientX,
                        e.clientY,
                      );
                      return;
                    }
                    showContextMenu(
                      createTabActions({
                        onSave: handleSaveFile,
                        onClose: () => closeTab(path),
                        onCloseOthers: () => closeOtherTabs(path),
                        onCloseToRight: () => closeTabsToRight(path),
                        onCloseAll: closeAllTabs,
                        onReveal: () => revealInExplorer(path),
                        onRename: () => startRename(path),
                        onCopyPath: () => navigator.clipboard.writeText(path),
                        onDelete: () => handleDeleteFile(path),
                        canCloseOthers: openTabs.length > 1,
                        canCloseToRight: !isLast,
                      }),
                      e.clientX,
                      e.clientY,
                    );
                  }}
                  className={[
                    "flex items-center gap-1.5 px-3 text-[11px] shrink-0 max-w-[160px] transition-colors select-none",
                    isActive
                      ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-r border-border",
                    isBeingDragged ? "opacity-40" : "",
                  ].join(" ")}
                >
                  {isDiff ? (
                    <FileDiff size={11} className="shrink-0 text-orange-500" />
                  ) : isDirty ? (
                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  ) : null}
                  <span className="truncate">{name}</span>
                  <span
                    className="shrink-0 flex items-center justify-center w-3.5 h-3.5 rounded-sm opacity-50 hover:opacity-100 hover:bg-muted cursor-pointer"
                    onClick={(e) => closeTab(path, e)}
                  >
                    <X size={11} />
                  </span>
                </button>
              );
            })}
          </div>

          {activeTabPath && isDiffTab(activeTabPath) && (
            <TooltipProvider delayDuration={400}>
              <div className="flex items-center gap-0.5 my-auto mx-1 shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => onDiffViewModeChange(diffViewMode === "unified" ? "split" : "unified")}
                    >
                      {diffViewMode === "unified" ? <Rows3 size={11} /> : <Columns2 size={11} />}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{diffViewMode === "unified" ? "Switch to side-by-side view" : "Switch to unified view"}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onCloseAllDiffs}>
                      <XCircle size={11} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Close all diffs</TooltipContent>
                </Tooltip>
              </div>
            </TooltipProvider>
          )}

          {activeTabPath && !isDiffTab(activeTabPath) && (
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-6 w-6 my-auto mx-1 shrink-0" onClick={handleSaveFile}>
                    <Save size={11} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Save (Ctrl+S)</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}

      {activeTabPath ? (
        <div className="flex-1 overflow-hidden">
          {activeTabPath === MAIN_DIFF_TAB_ID ? (
            <DiffAccordionView project={settings.project} openDiffs={openDiffs} viewMode={diffViewMode} onCloseDiff={onCloseDiff} />
          ) : (
            <CodeMirrorEditor
              value={tabContents[activeTabPath] ?? ""}
              onChange={handleContentChange}
              onBlur={handleEditorBlur}
              filename={activeTabPath}
              viewRef={editorViewRef}
              extraExtensions={gitGutterExtension}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <FileCode size={28} className="opacity-25" />
          <div className="text-sm font-medium">No file selected</div>
          <p className="text-xs opacity-60">Select a file from the tree to edit</p>
        </div>
      )}
    </div>
  );
}
