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
  FolderOpen,
  Settings,
} from "lucide-react";
import {
  WORKFLOW_REQUIREMENTS_PROMPT_BASE,
  WORKFLOW_ARCHITECT_PROMPT_BASE,
  WORKFLOW_STRUCTURE_PROMPT_BASE,
  WORKFLOW_STYLE_PROMPT_BASE,
  WORKFLOW_INTERACTION_PROMPT_BASE,
  WORKFLOW_REFERENCE_PROMPT_BASE,
  WORKFLOW_VALIDATE_PROMPT_BASE,
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
  { type: "input",        label: "Input",         desc: "Start of workflow",       tooltip: "Start of the workflow — receives user input",       category: "IO",          color: "var(--node-io)",         icon: LogIn },
  { type: "output",       label: "Output",        desc: "End of workflow",         tooltip: "End of the workflow — produces final output",      category: "IO",          color: "var(--node-io)",         icon: LogOut },
  { type: "writefile",    label: "Write File",    desc: "Write output to file",    tooltip: "Write output to file",                              category: "IO",          color: "var(--node-io)",         icon: FileOutput },
  { type: "requirements", label: "Requirements",  desc: "Parse requirements",      tooltip: extractRole(WORKFLOW_REQUIREMENTS_PROMPT_BASE),    category: "Analysis",    color: "var(--node-analysis)",    icon: ListChecks },
  { type: "designSystem", label: "Design System", desc: "Apply theme tokens",      tooltip: "Apply theme tokens",                                category: "Analysis",    color: "var(--node-analysis)",    icon: Palette },
  { type: "reference",    label: "Reference",     desc: "Analyze components",      tooltip: extractRole(WORKFLOW_REFERENCE_PROMPT_BASE),       category: "Analysis",    color: "var(--node-analysis)",    icon: BookOpen },
  { type: "architect",    label: "Architect",     desc: "Plan structure",          tooltip: extractRole(WORKFLOW_ARCHITECT_PROMPT_BASE),      category: "Planning",    color: "var(--node-planning)",    icon: Compass },
  { type: "structure",    label: "Structure",     desc: "Generate HTML/JSX",       tooltip: extractRole(WORKFLOW_STRUCTURE_PROMPT_BASE),      category: "Generation",  color: "var(--node-generation)",  icon: Layout },
  { type: "style",        label: "Style",         desc: "Apply CSS classes",       tooltip: extractRole(WORKFLOW_STYLE_PROMPT_BASE),          category: "Generation",  color: "var(--node-generation)",  icon: Paintbrush },
  { type: "interaction",  label: "Interaction",   desc: "Add state/hooks",         tooltip: extractRole(WORKFLOW_INTERACTION_PROMPT_BASE),    category: "Generation",  color: "var(--node-terminal)",    icon: MousePointerClick },
  { type: "parallel",     label: "Parallel",      desc: "Branch execution",        tooltip: "Branch execution into parallel paths",               category: "Composition", color: "var(--node-composition)", icon: GitBranch },
  { type: "composition",  label: "Composition",   desc: "Merge outputs",           tooltip: "Merge outputs from parallel branches",                category: "Composition", color: "var(--node-composition)", icon: Merge },
  { type: "bash",         label: "Bash",          desc: "Run shell command",       tooltip: "Run shell command",                                  category: "Utility",     color: "var(--node-utility)",     icon: Terminal },
  { type: "fetch",        label: "Fetch",         desc: "HTTP request",            tooltip: "HTTP request",                                       category: "Utility",     color: "var(--node-utility)",     icon: Globe },
  { type: "fileop",       label: "File Op",       desc: "Read / write files",      tooltip: "Read / write files",                                 category: "Utility",     color: "var(--node-utility)",     icon: FolderOpen },
  { type: "auth",         label: "Auth",          desc: "Authentication header",   tooltip: "Authentication header",                              category: "Utility",     color: "var(--node-terminal)",    icon: Lock },
  { type: "transform",    label: "Transform",     desc: "Transform content via AI", tooltip: extractRole(WORKFLOW_TRANSFORM_PROMPT_BASE),       category: "Utility",     color: "var(--node-utility)",     icon: Wand2 },
  { type: "validate",     label: "Validate",      desc: "Validate code output",    tooltip: extractRole(WORKFLOW_VALIDATE_PROMPT_BASE),       category: "Utility",     color: "var(--node-analysis)",    icon: ShieldCheck },
  { type: "preview",      label: "Preview",       desc: "Render HTML output",      tooltip: "Render HTML output",                                  category: "Utility",     color: "var(--node-io)",          icon: Eye },
  { type: "bun",          label: "Bun",           desc: "Bun dev / build",         tooltip: "Bun dev / build",                                     category: "Utility",     color: "var(--node-utility)",     icon: Package },
  { type: "runner",       label: "Runner",        desc: "Start dev server",        tooltip: "Start dev server",                                    category: "Utility",     color: "var(--node-generation)",  icon: Play },
  { type: "custom",       label: "Custom",        desc: "Custom AI node",          tooltip: "Custom AI node",                                      category: "Custom",      color: "var(--node-custom)",      icon: Sparkles },
];

export const CATEGORY_ORDER = ["IO", "Analysis", "Planning", "Generation", "Composition", "Utility", "Custom"];

// ─── Custom node data ──────────────────────────────────────────────────────

export interface WorkflowNodeData {
  label: string;
  nodeType: string;
  color: string;
  desc: string;
  status: "idle" | "running" | "done" | "error";
  output?: string;
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
  [key: string]: unknown;
}

export type WorkflowNodeType = Node<WorkflowNodeData, "workflow">;

// ─── Custom node component ─────────────────────────────────────────────────

export function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
  const d = data;
  const borderColor =
    d.status === "done"    ? "var(--status-done)" :
    d.status === "error"   ? "var(--status-error)" :
    d.status === "running" ? "var(--status-running)" :
    selected               ? "var(--primary)" :
                                "var(--border)";

  const def = BUILTIN_NODE_TYPES.find((t) => t.type === d.nodeType);
  const Icon = def?.icon ?? Settings;

  return (
    <div
      className="bg-card rounded-lg shadow-md relative cursor-pointer"
      style={{ width: 160, minHeight: 60, border: `1.5px solid ${borderColor}` }}
    >
      <Handle type="target" position={Position.Left}  style={{ width: 12, height: 12, borderColor }} />
      <Handle type="source" position={Position.Right} style={{ width: 12, height: 12, borderColor }} />

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
        </div>
        <div className="text-[9px] text-muted-foreground truncate mt-0.5">
          {d.status === "error" && d.output ? d.desc : (d.output || d.desc)}
        </div>
        {d.status === "error" && d.output && (
          <div className="text-[9px] text-destructive truncate">{d.output.slice(0, 80)}</div>
        )}
      </div>
    </div>
  );
}

export const nodeTypes = { workflow: WorkflowNode };

export function generateId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}