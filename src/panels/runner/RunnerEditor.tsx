import { useState, useEffect, useRef, memo } from "react";
import { X, FileCode, Save } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { showContextMenu, createTabActions } from "@/lib/context-menu";
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
  monitorForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import {
  attachClosestEdge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { reorderWithEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/reorder-with-edge";

export interface RunnerEditorProps {
  openTabs: string[];
  activeTabPath: string | null;
  tabContents: Record<string, string>;
  dirtyTabs: Set<string>;
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
}

// ─── Tab subcomponent ─────────────────────────────────────────────────────────

interface TabProps {
  path: string;
  isActive: boolean;
  isDirty: boolean;
  isLast: boolean;
  openTabsLength: number;
  liveOrderRef: React.MutableRefObject<string[]>;
  setLiveOrder: React.Dispatch<React.SetStateAction<string[]>>;
  openTab: (path: string) => void;
  closeTab: (path: string, e?: MouseEvent) => void;
  closeOtherTabs: (path: string) => void;
  closeTabsToRight: (path: string) => void;
  closeAllTabs: () => void;
  handleSaveFile: () => void;
  startRename: (path: string) => void;
  handleDeleteFile: (path: string) => void;
  revealInExplorer: (path: string) => void;
}

const Tab = memo(function Tab({
  path,
  isActive,
  isDirty,
  isLast,
  openTabsLength,
  liveOrderRef,
  setLiveOrder,
  openTab,
  closeTab,
  closeOtherTabs,
  closeTabsToRight,
  closeAllTabs,
  handleSaveFile,
  startRename,
  handleDeleteFile,
  revealInExplorer,
}: TabProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const name = path.split("/").pop() ?? path;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return combine(
      draggable({
        element: el,
        getInitialData: () => ({ type: "tab", path }),
        onGenerateDragPreview: ({ nativeSetDragImage }) => {
          setCustomNativeDragPreview({
            render({ container }) {
              const ghost = document.createElement("div");
              ghost.textContent = name;
              Object.assign(ghost.style, {
                padding: "3px 10px",
                background: "var(--card)",
                color: "var(--foreground)",
                border: "1px solid var(--border)",
                borderRadius: "4px",
                fontSize: "11px",
                fontFamily: "inherit",
                whiteSpace: "nowrap",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              });
              container.appendChild(ghost);
            },
            nativeSetDragImage,
          });
        },
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),

      dropTargetForElements({
        element: el,
        canDrop: ({ source }) =>
          source.data.type === "tab" && source.data.path !== path,
        getData: ({ input, element }) =>
          attachClosestEdge({ type: "tab", path }, {
            input,
            element,
            allowedEdges: ["left", "right"],
          }),
        onDrag: ({ source, self }) => {
          if (source.data.type !== "tab") return;
          const edge = extractClosestEdge(self.data);
          if (!edge) return;

          const draggedPath = source.data.path as string;
          const current = liveOrderRef.current;
          const startIndex = current.indexOf(draggedPath);
          const targetIndex = current.indexOf(path);
          if (startIndex === -1 || targetIndex === -1) return;

          const newOrder = reorderWithEdge({
            list: current,
            startIndex,
            indexOfTarget: targetIndex,
            closestEdgeOfTarget: edge,
            axis: "horizontal",
          });

          // Only update if the order actually changed
          if (newOrder.some((p, i) => p !== current[i])) {
            liveOrderRef.current = newOrder;
            setLiveOrder(newOrder);
          }
        },
      }),
    );
  // path and name are stable for a tab's lifetime (keyed by path)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, name]);

  return (
    <button
      ref={ref}
      onClick={() => openTab(path)}
      onAuxClick={(e) => { if (e.button === 1) closeTab(path, e); }}
      onContextMenu={(e) => {
        e.preventDefault();
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
            canCloseOthers: openTabsLength > 1,
            canCloseToRight: !isLast,
          }),
          e.clientX,
          e.clientY,
        );
      }}
      className={[
        "flex items-center gap-1.5 px-3 text-[11px] border-r border-border shrink-0 max-w-[160px] transition-colors select-none cursor-grab active:cursor-grabbing",
        isActive
          ? "bg-background text-foreground border-b-2 border-b-primary -mb-px"
          : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
        isDragging ? "opacity-40" : "",
      ].join(" ")}
    >
      {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
      <span className="truncate">{name}</span>
      <X
        size={10}
        className="shrink-0 opacity-50 hover:opacity-100"
        onClick={(e) => closeTab(path, e)}
      />
    </button>
  );
});

// ─── RunnerEditor ─────────────────────────────────────────────────────────────

/** Tab bar + CodeMirror editor body. State and persistence live in RunnerPanel;
 *  this component owns drag state only. */
export function RunnerEditor({
  openTabs,
  activeTabPath,
  tabContents,
  dirtyTabs,
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
}: RunnerEditorProps) {
  // liveOrder drives what's rendered during a drag; committed to the store on drop.
  const [liveOrder, setLiveOrder] = useState(openTabs);
  const liveOrderRef = useRef(openTabs);
  const openTabsRef = useRef(openTabs);
  const isDraggingRef = useRef(false);
  const [animateRef] = useAutoAnimate({ duration: 140, easing: "ease-in-out" });

  // Keep refs in sync
  useEffect(() => {
    openTabsRef.current = openTabs;
    // Only sync liveOrder from store when not mid-drag (avoid fighting the live updates)
    if (!isDraggingRef.current) {
      liveOrderRef.current = openTabs;
      setLiveOrder(openTabs);
    }
  }, [openTabs]);

  // Single monitor for the whole tab bar: commits live order on valid drop.
  // Native 'dragend' fires for both valid drops and cancellations; we use a
  // closure variable to distinguish them and restore on cancel.
  useEffect(() => {
    let didDrop = false;

    const cleanupMonitor = monitorForElements({
      canMonitor: ({ source }) => source.data.type === "tab",
      onDragStart: () => {
        isDraggingRef.current = true;
        didDrop = false;
      },
      onDrop: () => {
        didDrop = true;
        isDraggingRef.current = false;
        reorderTabs(liveOrderRef.current);
      },
    });

    // 'dragend' fires after onDrop (valid) or alone (cancelled).
    const handleDragEnd = () => {
      if (!didDrop && isDraggingRef.current) {
        // Drag was cancelled — restore committed order
        liveOrderRef.current = openTabsRef.current;
        setLiveOrder(openTabsRef.current);
      }
      isDraggingRef.current = false;
      didDrop = false;
    };
    document.addEventListener("dragend", handleDragEnd);

    return () => {
      cleanupMonitor();
      document.removeEventListener("dragend", handleDragEnd);
    };
  }, [reorderTabs]);

  return (
    <div className="h-full flex flex-col">
      {openTabs.length > 0 && (
        <div className="flex items-stretch border-b border-border bg-card shrink-0" style={{ height: 32 }}>
          <div ref={animateRef} className="flex items-stretch overflow-x-auto flex-1 min-w-0">
            {liveOrder.map((path, index) => (
              <Tab
                key={path}
                path={path}
                isActive={path === activeTabPath}
                isDirty={dirtyTabs.has(path)}
                isLast={index === liveOrder.length - 1}
                openTabsLength={liveOrder.length}
                liveOrderRef={liveOrderRef}
                setLiveOrder={setLiveOrder}
                openTab={openTab}
                closeTab={closeTab}
                closeOtherTabs={closeOtherTabs}
                closeTabsToRight={closeTabsToRight}
                closeAllTabs={closeAllTabs}
                handleSaveFile={handleSaveFile}
                startRename={startRename}
                handleDeleteFile={handleDeleteFile}
                revealInExplorer={revealInExplorer}
              />
            ))}
          </div>

          {activeTabPath && (
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 my-auto mx-1 shrink-0"
                    onClick={handleSaveFile}
                  >
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
          <CodeMirrorEditor
            value={tabContents[activeTabPath] ?? ""}
            onChange={handleContentChange}
            onBlur={handleEditorBlur}
            filename={activeTabPath}
          />
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
