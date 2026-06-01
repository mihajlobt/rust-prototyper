import { FolderOpen, RotateCw, Save, Trash2, X, FilePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileEntry } from "@/lib/ipc";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/workflows/templates";
import { useWorkflowPersistence } from "@/workflows/useWorkflowPersistence";

type PersistenceActions = Pick<
  ReturnType<typeof useWorkflowPersistence>,
  "handleLoad" | "handleSave" | "handleDelete" | "refreshSavedWorkflows"
>;

export interface WorkflowsPanelProps extends PersistenceActions {
  workflowId: string;
  setWorkflowId: (id: string) => void;
  savedWorkflows: FileEntry[];
  deleteConfirm: string | null;
  setDeleteConfirm: (name: string | null) => void;
  saveError: string | null;
  handleNew: () => void;
  handleLoadTemplate: (template: WorkflowTemplate) => void;
  nodeCount: number;
  edgeCount: number;
  onClose: () => void;
}

/**
 * Saved Workflows sidebar. Renders the active workflow name input, the list of
 * persisted workflows with load/delete affordances, the "New blank" action, and
 * the built-in workflow template gallery.
 */
export function WorkflowsPanel({
  workflowId,
  setWorkflowId,
  savedWorkflows,
  deleteConfirm,
  setDeleteConfirm,
  saveError,
  handleLoad,
  handleSave,
  handleDelete,
  handleNew,
  handleLoadTemplate,
  refreshSavedWorkflows,
  nodeCount,
  edgeCount,
  onClose,
}: WorkflowsPanelProps) {
  return (
    <div className="absolute top-0 right-0 h-full w-[260px] bg-card border-l border-border z-40 flex flex-col shadow-xl">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <FolderOpen size={14} />
        <span className="text-sm font-medium flex-1">Saved Workflows</span>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refreshSavedWorkflows}>
          <RotateCw size={11} />
        </Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
          <X size={12} />
        </Button>
      </div>
      <div className="p-2 border-b border-border space-y-1.5">
        <div className="flex gap-1">
          <Input
            value={workflowId}
            onChange={(e) => setWorkflowId(e.target.value)}
            placeholder="Workflow name…"
            className="h-7 text-xs flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={handleSave}>
            <Save size={11} />Save
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground px-0.5">
          {nodeCount} nodes · {edgeCount} edges
        </p>
        {saveError && (
          <p className="text-[10px] text-destructive px-0.5 break-all">{saveError}</p>
        )}
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-2 space-y-1">
          {savedWorkflows.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-2 opacity-60">
              <FolderOpen size={20} />No saved workflows yet
            </div>
          )}
          {savedWorkflows.map((wf) => {
            const name = wf.name.replace(".json", "");
            const isActive = workflowId === name;
            const isConfirm = deleteConfirm === wf.name;
            return (
              <div
                key={wf.path}
                className={[
                  "rounded-md border transition-colors",
                  isActive
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate">{name}</div>
                    {isActive && <div className="text-[10px] text-primary">currently loaded</div>}
                  </div>
                  {!isConfirm ? (
                    <div className="flex gap-0.5 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => handleLoad(wf.name)}
                      >
                        Load
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteConfirm(wf.name)}
                      >
                        <Trash2 size={10} />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-1 shrink-0">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => handleDelete(wf.name)}
                      >
                        Delete
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-[10px] px-2"
                        onClick={() => setDeleteConfirm(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
      <div className="p-2 border-t border-border space-y-1.5">
        <Button
          variant="outline"
          size="sm"
          className="w-full h-7 text-xs gap-1"
          onClick={handleNew}
        >
          <FilePlus size={11} />New blank workflow
        </Button>
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5 pt-1">
          Templates
        </p>
        {WORKFLOW_TEMPLATES.map((t) => (
          <button
            key={t.id}
            className="w-full text-left px-2 py-1.5 text-xs rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors"
            onClick={() => handleLoadTemplate(t)}
          >
            <span className="font-medium">{t.label}</span>
            <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">
              {t.description}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
