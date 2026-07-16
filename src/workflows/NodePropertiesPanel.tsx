import { useState } from "react";
import { Settings, Copy, Trash2, X, Edit2, Check, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageContent } from "@/components/ui/message";
import { Tool, type ToolPart } from "@/components/ui/tool";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import type { WorkflowNodeData } from "@/workflows/nodeTypes";
import {
  InputNodeFields, WriteFileFields, BashFields, FetchFields, FileOpFields,
  AuthFields, TransformFields, DesignSystemFields, BunFields, RunnerFields,
  ContextOverrideFields, PreviewFields, ComponentizeFields,
  ConditionFields, LoopUntilFields, SummarizeFields, DiffFields,
  JsonExtractFields, LinterFields, GitOpFields, MemoryKeyField,
} from "@/workflows/NodeFieldSections";
import {
  WORKFLOW_REQUIREMENTS_PROMPT_BASE, WORKFLOW_ARCHITECT_PROMPT_BASE,
  WORKFLOW_STRUCTURE_PROMPT_BASE, WORKFLOW_STYLE_PROMPT_BASE,
  WORKFLOW_INTERACTION_PROMPT_BASE, WORKFLOW_COMPONENTIZE_PROMPT_BASE, WORKFLOW_REFERENCE_PROMPT_BASE,
  WORKFLOW_VALIDATE_PROMPT_BASE, WORKFLOW_TRANSFORM_PROMPT_BASE,
  WORKFLOW_SUMMARIZE_PROMPT_BASE, WORKFLOW_CONDITION_PROMPT_BASE,
  WORKFLOW_LOOP_FIX_PROMPT_BASE,
} from "@/lib/prompts";

const DEFAULT_SYSTEM_PROMPTS: Record<string, string> = {
  requirements: WORKFLOW_REQUIREMENTS_PROMPT_BASE,
  architect:    WORKFLOW_ARCHITECT_PROMPT_BASE,
  structure:    WORKFLOW_STRUCTURE_PROMPT_BASE,
  style:        WORKFLOW_STYLE_PROMPT_BASE,
  interaction:  WORKFLOW_INTERACTION_PROMPT_BASE,
  componentize: WORKFLOW_COMPONENTIZE_PROMPT_BASE,
  reference:    WORKFLOW_REFERENCE_PROMPT_BASE,
  validate:     WORKFLOW_VALIDATE_PROMPT_BASE,
  transform:    WORKFLOW_TRANSFORM_PROMPT_BASE,
  summarize:    WORKFLOW_SUMMARIZE_PROMPT_BASE,
  condition:    WORKFLOW_CONDITION_PROMPT_BASE,
  loopuntil:    WORKFLOW_LOOP_FIX_PROMPT_BASE,
};

const AI_NODE_TYPES = new Set([
  "requirements", "architect", "structure", "style", "interaction", "componentize", "reference",
  "validate", "transform", "custom", "summarize", "condition", "loopuntil",
]);

const CONTEXT_OVERRIDE_TYPES = new Set([
  "requirements", "architect", "structure", "style", "interaction", "reference", "validate",
]);

interface NodePropertiesPanelProps {
  nodeId: string;
  data: WorkflowNodeData;
  onUpdate: (id: string, patch: Partial<WorkflowNodeData>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
  onViewOutput: () => void;
}

export function NodePropertiesPanel({ nodeId, data, onUpdate, onDuplicate, onDelete, onClose, onViewOutput }: NodePropertiesPanelProps) {
  const set = (patch: Partial<WorkflowNodeData>) => onUpdate(nodeId, patch);
  const isRunning = data.status === "running";
  const isError = data.status === "error";
  const hasOutput = !!data.output;
  const [editingPrompt, setEditingPrompt] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");

  function statusToToolState(): ToolPart["state"] {
    switch (data.status) {
      case "running": return "input-streaming";
      case "done": return "output-available";
      case "error": return "output-error";
      case "paused": return "input-available";
      default: return "input-available";
    }
  }

  const toolPart: ToolPart = {
    type: data.label,
    state: statusToToolState(),
    ...(hasOutput && { output: { content: data.output!.slice(0, 200) } }),
    ...(isError && data.output && { errorText: data.output.slice(0, 200) }),
  };

  const isCustomType = data.nodeType === "custom" || data.nodeType.startsWith("custom_");
  const hasSystemPrompt = AI_NODE_TYPES.has(data.nodeType) || isCustomType;
  const hasContextOverride = CONTEXT_OVERRIDE_TYPES.has(data.nodeType);

  const openEditor = () => {
    setDraftPrompt(data.systemPrompt || DEFAULT_SYSTEM_PROMPTS[data.nodeType] || "");
    setEditingPrompt(true);
  };

  const closeEditor = () => {
    const defaultPrompt = DEFAULT_SYSTEM_PROMPTS[data.nodeType] || "";
    set({ systemPrompt: draftPrompt === defaultPrompt ? undefined : draftPrompt });
    setEditingPrompt(false);
  };

  return (
    <div
      className="nowheel nopan w-[420px] bg-card border border-border rounded-lg flex flex-col shadow-xl"
      style={{ maxHeight: "85vh" }}
    >
      <div className="panel-toolbar h-10 px-3 gap-2 rounded-t-lg border-b border-border shrink-0">
        <Settings size={14} />
        <span className="text-sm font-medium flex-1 truncate">{data.label}</span>
        {isRunning && <Loader variant="dots" size="sm" />}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDuplicate} title="Duplicate"><Copy size={11} /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete} title="Delete"><Trash2 size={12} className="text-destructive" /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close"><X size={12} /></Button>
      </div>

      <ScrollArea className="flex-1 overflow-hidden min-h-0">
        <div className="p-3 space-y-3 min-w-0">
          {/* Label */}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Label</label>
            <Input value={data.label} onChange={(e) => set({ label: e.target.value })} className="h-7 text-xs" />
          </div>

          {/* Per-node system prompt (all AI nodes) */}
          {hasSystemPrompt && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">System Prompt</label>
              <div className="relative">
                {editingPrompt ? (
                  <div className="rounded border border-border overflow-hidden w-full">
                    <CodeMirrorEditor
                      value={draftPrompt}
                      onChange={setDraftPrompt}
                      mode="markdown"
                      height="200px"
                      lineWrapping
                      minimal
                    />
                  </div>
                ) : (
                  <div className="rounded bg-muted px-2 py-1.5 min-h-[40px] max-h-[160px] overflow-y-auto">
                    {data.systemPrompt ? (
                      <MessageContent
                        markdown
                        className="text-[11px] text-muted-foreground bg-transparent p-0 prose-headings:text-foreground"
                      >
                        {data.systemPrompt}
                      </MessageContent>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/60 italic">Using default system prompt — click Edit to override</span>
                    )}
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  className="absolute top-1.5 right-1.5 h-5 px-1.5 text-[10px] gap-1 z-10 opacity-80 hover:opacity-100"
                  onClick={editingPrompt ? closeEditor : openEditor}
                >
                  {editingPrompt ? <><Check size={9} />Done</> : <><Edit2 size={9} />Edit</>}
                </Button>
              </div>
            </div>
          )}

          {/* Per-type configuration fields */}
          {data.nodeType === "input"       && <InputNodeFields data={data} set={set} />}
          {data.nodeType === "writefile"   && <WriteFileFields data={data} set={set} />}
          {data.nodeType === "bash"        && <BashFields data={data} set={set} />}
          {data.nodeType === "fetch"       && <FetchFields data={data} set={set} />}
          {data.nodeType === "fileop"      && <FileOpFields data={data} set={set} />}
          {data.nodeType === "auth"        && <AuthFields data={data} set={set} />}
          {data.nodeType === "transform"   && <TransformFields data={data} set={set} />}
          {data.nodeType === "designSystem"&& <DesignSystemFields data={data} set={set} />}
          {data.nodeType === "bun"         && <BunFields data={data} set={set} />}
          {data.nodeType === "runner"      && <RunnerFields data={data} set={set} />}
          {data.nodeType === "condition"   && <ConditionFields data={data} set={set} />}
          {data.nodeType === "loopuntil"   && <LoopUntilFields data={data} set={set} />}
          {data.nodeType === "summarize"   && <SummarizeFields data={data} set={set} />}
          {data.nodeType === "diff"        && <DiffFields data={data} set={set} />}
          {data.nodeType === "jsonextract" && <JsonExtractFields data={data} set={set} />}
          {data.nodeType === "linter"      && <LinterFields data={data} set={set} />}
          {data.nodeType === "gitop"       && <GitOpFields data={data} set={set} />}
          {data.nodeType === "componentize"&& <ComponentizeFields data={data} set={set} />}
          {(data.nodeType === "memorystore" || data.nodeType === "memoryload") && <MemoryKeyField data={data} set={set} />}
          {isCustomType && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">User Prompt / Input</label>
              <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[80px] resize-none" placeholder="Enter prompt…" />
            </div>
          )}
          {hasContextOverride && (
            <ContextOverrideFields data={data} set={set} />
          )}
          {data.nodeType === "preview" && <PreviewFields data={data} set={set} />}

          {/* Status + output */}
          <div className="pt-2 border-t border-border space-y-2">
            <Tool toolPart={toolPart} defaultOpen={isRunning || isError} className="text-xs" />

            {(hasOutput || isRunning) && (
              <Button
                variant="outline"
                size="sm"
                className="w-full h-7 text-xs gap-1.5"
                onClick={onViewOutput}
              >
                <MessageSquare size={12} />
                {isRunning && !hasOutput ? "View Progress" : "View Output"}
              </Button>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
