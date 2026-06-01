import { X, FileCode, Save } from "lucide-react";
import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { showContextMenu, createTabActions } from "@/lib/context-menu";

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
}

/** Tab bar + CodeMirror editor body for the Runner panel.
 *  All state and persistence lives in RunnerPanel — this component is a pure view
 *  over the tab list and dirty flags, with handler callbacks bubbled up. */
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
}: RunnerEditorProps) {
  return (
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
                <button
                  key={path}
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
                        canCloseOthers: openTabs.length > 1,
                        canCloseToRight: !isLast,
                      }),
                      e.clientX,
                      e.clientY
                    );
                  }}
                  className={["flex items-center gap-1.5 px-3 text-[11px] border-r border-border shrink-0 max-w-[160px] transition-colors", isActive ? "bg-background text-foreground border-b-2 border-b-primary -mb-px" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")}
                >
                  {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />}
                  <span className="truncate">{name}</span>
                  <X size={10} className="shrink-0 opacity-50 hover:opacity-100" onClick={(e) => closeTab(path, e)} />
                </button>
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
        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
          <FileCode size={28} className="opacity-25" />
          <div className="text-sm font-medium">No file selected</div>
          <p className="text-xs opacity-60">Select a file from the tree to edit</p>
        </div>
      )}
    </div>
  );
}
