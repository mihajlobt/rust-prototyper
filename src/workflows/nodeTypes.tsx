// Workflow node type definitions, data interface, and the custom WorkflowNode component.

import type { LucideIcon } from "lucide-react";
import {
  type Node,
  type NodeProps,
  Handle,
  Position,
} from "@xyflow/react";
import {
  LogIn, LogOut, FileOutput, ListChecks, Palette, BookOpen, Compass,
  Layout, Paintbrush, MousePointerClick, GitBranch, Merge,
  Terminal, Globe, Lock, Wand2, ShieldCheck, Eye, Package, Play, Sparkles,
  FolderOpen, Settings, GitFork, Repeat2, AlignLeft, Braces, FileDiff,
  FileJson, ScanLine, GitCommit, Database, HardDrive,
  Copy, Trash2, Unplug,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import { useWorkflowActions } from "@/workflows/WorkflowActionsContext";
import {
  WORKFLOW_REQUIREMENTS_PROMPT_BASE,
  WORKFLOW_ARCHITECT_PROMPT_BASE,
  WORKFLOW_STRUCTURE_PROMPT_BASE,
  WORKFLOW_STYLE_PROMPT_BASE,
  WORKFLOW_INTERACTION_PROMPT_BASE,
  WORKFLOW_REFERENCE_PROMPT_BASE,
  WORKFLOW_TRANSFORM_PROMPT_BASE,
} from "@/lib/prompts";

/** Extract the ROLE description from a workflow prompt (first line after "ROLE:"). */
function extractRole(prompt: string): string {
  const match = prompt.match(/ROLE:\s*\n\s*-\s*(.+)/);
  return match ? match[1].trim() : "";
}

// ─── Node type definitions ─────────────────────────────────────────────────

export interface NodeTypeDef {
  type: string;
  label: string;
  desc: string;
  tooltip: string;
  category: string;
  color: string;
  icon: LucideIcon;
}

export const BUILTIN_NODE_TYPES: NodeTypeDef[] = [
  // IO
  { type: "input",        label: "Input",         desc: "Start of workflow",       tooltip: "Start of the workflow — receives user input",       category: "IO",          color: "var(--node-io)",         icon: LogIn },
  { type: "output",       label: "Output",        desc: "End of workflow",         tooltip: "End of the workflow — produces final output",      category: "IO",          color: "var(--node-io)",         icon: LogOut },
  { type: "writefile",    label: "Write File",    desc: "Write output to file",    tooltip: "Write output to file",                              category: "IO",          color: "var(--node-io)",         icon: FileOutput },
  // Analysis
  { type: "requirements", label: "Requirements",  desc: "Parse requirements",      tooltip: extractRole(WORKFLOW_REQUIREMENTS_PROMPT_BASE),    category: "Analysis",    color: "var(--node-analysis)",    icon: ListChecks },
  { type: "designSystem", label: "Design System", desc: "Apply theme tokens",      tooltip: "Apply theme tokens",                                category: "Analysis",    color: "var(--node-analysis)",    icon: Palette },
  { type: "reference",    label: "Reference",     desc: "Analyze components",      tooltip: extractRole(WORKFLOW_REFERENCE_PROMPT_BASE),       category: "Analysis",    color: "var(--node-analysis)",    icon: BookOpen },
  // Planning
  { type: "architect",    label: "Architect",     desc: "Plan structure",          tooltip: extractRole(WORKFLOW_ARCHITECT_PROMPT_BASE),      category: "Planning",    color: "var(--node-planning)",    icon: Compass },
  // Generation
  { type: "structure",    label: "Structure",     desc: "Generate HTML/JSX",       tooltip: extractRole(WORKFLOW_STRUCTURE_PROMPT_BASE),      category: "Generation",  color: "var(--node-generation)",  icon: Layout },
  { type: "style",        label: "Style",         desc: "Apply CSS classes",       tooltip: extractRole(WORKFLOW_STYLE_PROMPT_BASE),          category: "Generation",  color: "var(--node-generation)",  icon: Paintbrush },
  { type: "interaction",  label: "Interaction",   desc: "Add state/hooks",         tooltip: extractRole(WORKFLOW_INTERACTION_PROMPT_BASE),    category: "Generation",  color: "var(--node-terminal)",    icon: MousePointerClick },
  // Composition
  { type: "parallel",     label: "Parallel",      desc: "Branch execution",        tooltip: "Branch execution into parallel paths",               category: "Composition", color: "var(--node-composition)", icon: GitBranch },
  { type: "composition",  label: "Composition",   desc: "Merge outputs",           tooltip: "Merge outputs from parallel branches",                category: "Composition", color: "var(--node-composition)", icon: Merge },
  { type: "condition",    label: "Condition",     desc: "Branch on condition",     tooltip: "Evaluates a JS expression or AI judge against input — passes or blocks flow", category: "Composition", color: "var(--node-composition)", icon: GitFork },
  { type: "loopuntil",    label: "Loop Until",    desc: "Retry until condition",   tooltip: "Runs validation command; if it fails, AI-fixes the code and retries up to N times", category: "Composition", color: "var(--node-composition)", icon: Repeat2 },
  // Utility
  { type: "bash",         label: "Bash",          desc: "Run shell command",       tooltip: "Run shell command",                                  category: "Utility",     color: "var(--node-utility)",     icon: Terminal },
  { type: "fetch",        label: "Fetch",         desc: "HTTP request",            tooltip: "HTTP request",                                       category: "Utility",     color: "var(--node-utility)",     icon: Globe },
  { type: "fileop",       label: "File Op",       desc: "Read / write files",      tooltip: "Read / write files",                                 category: "Utility",     color: "var(--node-utility)",     icon: FolderOpen },
  { type: "auth",         label: "Auth",          desc: "Authentication header",   tooltip: "Authentication header",                              category: "Utility",     color: "var(--node-terminal)",    icon: Lock },
  { type: "transform",    label: "Transform",     desc: "Transform content via AI", tooltip: extractRole(WORKFLOW_TRANSFORM_PROMPT_BASE),       category: "Utility",     color: "var(--node-utility)",     icon: Wand2 },
  { type: "validate",     label: "Validate",      desc: "Run tsc + eslint",        tooltip: "Runs bun tsc --noEmit and eslint, capturing real compiler output", category: "Utility", color: "var(--node-analysis)", icon: ShieldCheck },
  { type: "preview",      label: "Preview",       desc: "Render HTML output",      tooltip: "Render HTML output",                                  category: "Utility",     color: "var(--node-io)",          icon: Eye },
  { type: "bun",          label: "Bun",           desc: "Bun dev / build",         tooltip: "Bun dev / build",                                     category: "Utility",     color: "var(--node-utility)",     icon: Package },
  { type: "runner",       label: "Runner",        desc: "Start dev server",        tooltip: "Start dev server",                                    category: "Utility",     color: "var(--node-generation)",  icon: Play },
  { type: "summarize",    label: "Summarize",     desc: "Compress long context",   tooltip: "AI-compresses large outputs to prevent context overflow in downstream nodes", category: "Utility", color: "var(--node-utility)", icon: AlignLeft },
  { type: "codeextract",  label: "Code Extract",  desc: "Strip markdown fences",   tooltip: "Strips markdown code fences from AI output — extracts raw code", category: "Utility", color: "var(--node-utility)", icon: Braces },
  { type: "diff",         label: "Diff",          desc: "Unified diff",            tooltip: "Computes a unified diff between base content and previous node output", category: "Utility", color: "var(--node-utility)", icon: FileDiff },
  { type: "jsonextract",  label: "JSON Extract",  desc: "Extract JSON path",       tooltip: "Parses JSON from input and extracts a dot-notation path (e.g. data.items.0.name)", category: "Utility", color: "var(--node-utility)", icon: FileJson },
  { type: "linter",       label: "Linter",        desc: "Run eslint/prettier",     tooltip: "Runs eslint and/or prettier on the generated project, capturing results with line numbers", category: "Utility", color: "var(--node-analysis)", icon: ScanLine },
  { type: "gitop",        label: "Git Op",        desc: "Git operations",          tooltip: "Run git status, add, or commit — commit message can come from previous node", category: "Utility", color: "var(--node-utility)", icon: GitCommit },
  { type: "memorystore",  label: "Memory Store",  desc: "Store to scratchpad",     tooltip: "Stores previous node output in a named workflow-run scratchpad key", category: "Utility", color: "var(--node-utility)", icon: Database },
  { type: "memoryload",   label: "Memory Load",   desc: "Load from scratchpad",    tooltip: "Loads a value from the workflow-run scratchpad by key", category: "Utility", color: "var(--node-utility)", icon: HardDrive },
  // Custom
  { type: "custom",       label: "Custom",        desc: "Custom AI node",          tooltip: "Custom AI node",                                      category: "Custom",      color: "var(--node-custom)",      icon: Sparkles },
];

export const CATEGORY_ORDER = ["IO", "Analysis", "Planning", "Generation", "Composition", "Utility", "Custom"];

// ─── Custom node data ──────────────────────────────────────────────────────

export interface WorkflowNodeData {
  label: string;
  nodeType: string;
  color: string;
  desc: string;
  status: "idle" | "running" | "done" | "error" | "paused";
  output?: string;
  /** Per-node system prompt override. Overrides the global prompt for AI nodes. */
  systemPrompt?: string;
  prompt?: string;
  command?: string;
  url?: string;
  method?: string;
  headers?: string;
  body?: string;
  path?: string;
  operation?: string;
  content?: string;
  authScheme?: string;
  authToken?: string;
  authHeaderName?: string;
  mode?: string;
  port?: string;
  // Condition node
  conditionMode?: "expression" | "ai";
  expression?: string;
  judgePrompt?: string;
  // LoopUntil node
  maxIterations?: number;
  validationCommand?: string;
  fixPrompt?: string;
  // Diff node
  baseContent?: string;
  // JSON Extract node
  jsonPath?: string;
  // Linter node
  lintTarget?: "tsc" | "eslint" | "both";
  // Git Op node
  gitCommand?: string;
  commitMessage?: string;
  // Memory nodes
  memoryKey?: string;
  /** Persisted :pass branch output for validate/condition nodes (survives pause/resume). */
  passOutput?: string;
  /** Persisted :fail branch output for validate/condition nodes (survives pause/resume). */
  failOutput?: string;
  [key: string]: unknown;
}

export type WorkflowNodeType = Node<WorkflowNodeData, "workflow">;

// ─── Custom node component ─────────────────────────────────────────────────

const BRANCHING_NODE_TYPES = new Set(["validate", "condition"]);

export function WorkflowNode({ data, selected, id }: NodeProps<WorkflowNodeType>) {
  const d = data;
  const actions = useWorkflowActions();
  const borderColor =
    d.status === "done"    ? "var(--status-done)" :
    d.status === "error"   ? "var(--status-error)" :
    d.status === "running" ? "var(--status-running)" :
    d.status === "paused"  ? "var(--status-paused)" :
    selected               ? "var(--primary)" :
                                "var(--border)";

  const def = BUILTIN_NODE_TYPES.find((t) => t.type === d.nodeType);
  const Icon = def?.icon ?? Settings;
  const isBranching = BRANCHING_NODE_TYPES.has(d.nodeType);

  const inner = (
    <div
      className="bg-card rounded-lg shadow-md relative cursor-pointer"
      style={{ width: 160, minHeight: 60, border: `1.5px solid ${borderColor}` }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12, borderColor }} />

      {isBranching ? (
        <>
          <Handle type="source" id="pass" position={Position.Right}
            style={{ top: "33%", width: 10, height: 10, background: "var(--status-done)", borderColor: "var(--status-done)" }} />
          <Handle type="source" id="fail" position={Position.Right}
            style={{ top: "67%", width: 10, height: 10, background: "var(--status-error)", borderColor: "var(--status-error)" }} />
        </>
      ) : (
        <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, borderColor }} />
      )}

      <div className="px-3 pt-1.5 pb-2">
        <div className="wf-accent-bar mb-1.5" style={{ background: d.color }} />
        <div className="flex items-center gap-1.5">
          <Icon size={12} className="shrink-0" style={{ color: d.color }} />
          <span className="text-[11px] font-semibold truncate leading-tight flex-1">{d.label}</span>
          {d.status === "running" && (
            <span className="flex gap-0.5 shrink-0">
              <span className="thinking-dot w-1 h-1 rounded-full inline-block bg-status-running" />
              <span className="thinking-dot w-1 h-1 rounded-full inline-block bg-status-running" />
              <span className="thinking-dot w-1 h-1 rounded-full inline-block bg-status-running" />
            </span>
          )}
          {d.status === "paused" && (
            <span className="text-[9px] font-semibold shrink-0" style={{ color: "var(--status-paused)" }}>PAUSED</span>
          )}
        </div>
        <Separator className="my-1 opacity-40" />
        <div className="text-[9px] text-muted-foreground truncate">
          {d.status === "error" && d.output ? d.desc : (d.output || d.desc)}
        </div>
        {d.status === "error" && d.output && (
          <div className="text-[9px] text-destructive truncate">{d.output.slice(0, 80)}</div>
        )}
        {isBranching && (
          <div className="absolute right-2 inset-y-0 flex flex-col justify-around pointer-events-none">
            <span className="text-[7px] font-bold leading-none" style={{ color: "var(--status-done)" }}>pass</span>
            <span className="text-[7px] font-bold leading-none" style={{ color: "var(--status-error)" }}>fail</span>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        {inner}
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => actions?.duplicateNode(id)}>
            <Copy />Duplicate
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions?.disconnectEdges(id)}>
            <Unplug />Disconnect Edges
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" onClick={() => actions?.deleteNode(id)}>
            <Trash2 />Delete Node
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export const nodeTypes = { workflow: WorkflowNode };

export function generateId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}
