import type { Edge } from "@xyflow/react";
import type { WorkflowNodeData, WorkflowNodeType } from "@/workflows/nodeTypes";

// ─── Workflow Template Types ─────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  label: string;
  description: string;
  nodes: WorkflowNodeType[];
  edges: Edge[];
}

// ─── Helper ──────────────────────────────────────────────────────────────────

const n = (id: string, nodeType: string, label: string, desc: string, color: string, x: number, y: number, extra?: Record<string, unknown>): WorkflowNodeType => ({
  id,
  type: "workflow",
  position: { x, y },
  data: {
    label,
    nodeType,
    color,
    desc,
    status: "idle",
    ...extra,
  } satisfies WorkflowNodeData,
});

const e = (id: string, source: string, target: string): Edge => ({
  id,
  source,
  target,
  type: "smoothstep",
});

const eh = (id: string, source: string, target: string, sourceHandle: string): Edge => ({
  id,
  source,
  target,
  type: "smoothstep",
  sourceHandle,
});

// ─── CSS color variable references ───────────────────────────────────────────

const C = {
  io:         "var(--node-io)",
  analysis:   "var(--node-analysis)",
  planning:   "var(--node-planning)",
  generation: "var(--node-generation)",
  composition:"var(--node-composition)",
  utility:    "var(--node-utility)",
  terminal:   "var(--node-terminal)",
  custom:     "var(--node-custom)",
};

// ─── Templates ───────────────────────────────────────────────────────────────

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [

  // ── 1. Login Form Builder ────────────────────────────────────────────────
  {
    id: "login-form-builder",
    label: "Login Form Builder",
    description: "Full AI-to-code pipeline: prompt → requirements → architecture → code → style → interaction → preview → file output",
    nodes: [
      n("t1-n1", "input",        "User Prompt",   "Start of workflow", C.io,         60,  100, { prompt: "Build a modern login form with email and password fields, a Remember Me checkbox, a Forgot Password link, and a Submit button. Include social login options for Google and GitHub." }),
      n("t1-n2", "requirements", "Requirements",   "Parse requirements", C.analysis, 280, 100),
      n("t1-n3", "architect",    "Architect",      "Plan structure",     C.planning,  500, 100),
      n("t1-n4", "structure",    "Structure",      "Generate JSX",      C.generation, 720, 100),
      n("t1-n5", "style",        "Style",          "Apply CSS",         C.generation, 940, 100),
      n("t1-n6", "interaction",  "Interaction",    "Add state/hooks",   C.terminal,  1160, 100),
      n("t1-n7", "preview",      "Preview",        "Render output",     C.io,        1380, 100),
      n("t1-n8", "writefile",    "Write File",     "Write output",     C.io,        1600, 100, { path: "src/LoginForm.tsx" }),
    ],
    edges: [
      e("t1-e1", "t1-n1", "t1-n2"),
      e("t1-e2", "t1-n2", "t1-n3"),
      e("t1-e3", "t1-n3", "t1-n4"),
      e("t1-e4", "t1-n4", "t1-n5"),
      e("t1-e5", "t1-n5", "t1-n6"),
      e("t1-e6", "t1-n6", "t1-n7"),
      e("t1-e7", "t1-n7", "t1-n8"),
    ],
  },

  // ── 2. API Data Viewer ────────────────────────────────────────────────────
  {
    id: "api-data-viewer",
    label: "API Data Viewer",
    description: "Fetch + transform + display: fetches remote data, transforms it, generates a styled viewer component",
    nodes: [
      n("t2-n1", "input",      "User Prompt",   "Start of workflow", C.io,       60,  100, { prompt: "Create a dashboard that fetches user data from a public API and displays it in a searchable, sortable table with pagination" }),
      n("t2-n2", "requirements","Requirements",  "Parse requirements", C.analysis, 280, 100),
      n("t2-n3", "fetch",       "Fetch Users",  "HTTP request",      C.utility,  500, 100, { url: "https://jsonplaceholder.typicode.com/users", method: "GET" }),
      n("t2-n4", "transform",   "Transform",    "Extract fields",    C.utility,  720, 100, { prompt: "Extract name, email, phone, and company name from each user object. Format as a clean data summary suitable for a table component." }),
      n("t2-n5", "architect",   "Architect",     "Plan structure",    C.planning, 940, 100),
      n("t2-n6", "structure",   "Structure",     "Generate JSX",     C.generation, 1160, 100),
      n("t2-n7", "style",       "Style",         "Apply CSS",        C.generation, 1380, 100),
      n("t2-n8", "interaction",  "Interaction",   "Add search/sort",  C.terminal,  1600, 100),
      n("t2-n9", "preview",     "Preview",        "Render output",    C.io,        1820, 100),
    ],
    edges: [
      e("t2-e1", "t2-n1", "t2-n2"),
      e("t2-e2", "t2-n2", "t2-n3"),
      e("t2-e3", "t2-n3", "t2-n4"),
      e("t2-e4", "t2-n4", "t2-n5"),
      e("t2-e5", "t2-n5", "t2-n6"),
      e("t2-e6", "t2-n6", "t2-n7"),
      e("t2-e7", "t2-n7", "t2-n8"),
      e("t2-e8", "t2-n8", "t2-n9"),
    ],
  },

  // ── 3. Component Generator (parallel + composition) ───────────────────────
  {
    id: "component-generator",
    label: "Component Generator",
    description: "Parallel AI generation: requirements split into parallel structure + style branches, merged by composition, then validated",
    nodes: [
      n("t3-n1", "input",       "User Prompt",    "Start of workflow", C.io,          60,  200, { prompt: "Create a pricing card component with 3 tiers: Free, Pro ($9/mo), and Enterprise ($29/mo). Each tier shows features, a CTA button, and highlights the recommended plan." }),
      n("t3-n2", "requirements","Requirements",   "Parse requirements", C.analysis,   280, 200),
      n("t3-n3", "architect",   "Architect",      "Plan structure",   C.planning,    500, 200),
      n("t3-n4", "parallel",    "Parallel",       "Branch execution",  C.composition, 720, 200),
      n("t3-n5", "structure",   "Structure",      "Generate JSX",     C.generation,  980, 100),
      n("t3-n6", "style",       "Style",          "Apply CSS",        C.generation,  980, 300),
      n("t3-n7", "composition", "Composition",    "Merge outputs",    C.composition, 1220, 200),
      n("t3-n8", "validate",    "Validate",       "Validate code",    C.analysis,    1440, 200),
      n("t3-n9", "preview",     "Preview",        "Render output",    C.io,          1660, 200),
    ],
    edges: [
      e("t3-e1", "t3-n1", "t3-n2"),
      e("t3-e2", "t3-n2", "t3-n3"),
      e("t3-e3", "t3-n3", "t3-n4"),
      e("t3-e4", "t3-n4", "t3-n5"),
      e("t3-e5", "t3-n4", "t3-n6"),
      e("t3-e6", "t3-n5", "t3-n7"),
      e("t3-e7", "t3-n6", "t3-n7"),
      e("t3-e8",  "t3-n7", "t3-n8"),
      eh("t3-e9", "t3-n8", "t3-n9", "pass"),
    ],
  },

  // ── 4. Theme Applicator ──────────────────────────────────────────────────
  {
    id: "theme-applicator",
    label: "Theme Applicator",
    description: "Theme + code generation: applies a design system theme to generated code, writes to file, and starts dev server",
    nodes: [
      n("t4-n1", "input",       "User Prompt",     "Start of workflow", C.io,         60,  100, { prompt: "Build a SaaS dashboard with a sidebar navigation, 4 stats cards, a recent activity list, and a user profile dropdown" }),
      n("t4-n2", "designSystem","Design System",    "Apply theme tokens", C.analysis,  280, 100, { prompt: "default" }),
      n("t4-n3", "architect",   "Architect",        "Plan structure",    C.planning,  500, 100),
      n("t4-n4", "structure",   "Structure",        "Generate JSX",      C.generation, 720, 100),
      n("t4-n5", "style",       "Style",            "Apply CSS",         C.generation, 940, 100),
      n("t4-n6", "interaction", "Interaction",       "Add state/hooks",   C.terminal,   1160, 100),
      n("t4-n7", "writefile",   "Write File",        "Write output",      C.io,         1380, 100,  { path: "src/Dashboard.tsx" }),
      n("t4-n8", "writefile",   "Write Index",       "Write entry point", C.io,         1600, 100,  { path: "src/main.tsx", content: 'import { createRoot } from "react-dom/client";\nimport Dashboard from "./Dashboard";\ncreateRoot(document.getElementById("root")!).render(<Dashboard />);' }),
      n("t4-n9", "runner",      "Runner",            "Start dev server",  C.utility,    1820, 100,  { port: "5173" }),
    ],
    edges: [
      e("t4-e1", "t4-n1", "t4-n2"),
      e("t4-e2", "t4-n2", "t4-n3"),
      e("t4-e3", "t4-n3", "t4-n4"),
      e("t4-e4", "t4-n4", "t4-n5"),
      e("t4-e5", "t4-n5", "t4-n6"),
      e("t4-e6", "t4-n6", "t4-n7"),
      e("t4-e7", "t4-n7", "t4-n8"),
      e("t4-e8", "t4-n8", "t4-n9"),
    ],
  },

  // ── 5. Code Review Pipeline ──────────────────────────────────────────────
  {
    id: "code-review-pipeline",
    label: "Code Review Pipeline",
    description: "Validation-focused: generates code, validates it, transforms to fix issues, re-validates, and outputs clean code",
    nodes: [
      n("t5-n1", "input",      "User Prompt",    "Start of workflow", C.io,        60,  100, { prompt: "Generate a React notification toast component that supports success, error, warning, and info types with auto-dismiss and stack management" }),
      n("t5-n2", "structure",  "Structure",       "Generate JSX",     C.generation, 280, 100),
      n("t5-n3", "validate",   "Validate",        "First pass review", C.analysis,   500, 100),
      n("t5-n4", "transform",  "Transform",        "Fix issues",       C.utility,     720, 100, { prompt: "Fix all errors and warnings identified by the validation step. Preserve the overall architecture but correct type errors, add missing imports, improve accessibility, and address any code quality issues." }),
      n("t5-n5", "style",      "Style",            "Apply CSS",        C.generation,  940, 100),
      n("t5-n6", "validate",   "Validate",         "Second pass review", C.analysis,  1160, 100),
      n("t5-n7", "interaction","Interaction",       "Add state/hooks",  C.terminal,    1380, 100),
      n("t5-n8", "output",     "Output",           "End of workflow",  C.io,         1600, 100),
    ],
    edges: [
      e("t5-e1", "t5-n1", "t5-n2"),
      e("t5-e2",  "t5-n2", "t5-n3"),
      eh("t5-e3", "t5-n3", "t5-n4", "fail"),
      e("t5-e4",  "t5-n4", "t5-n5"),
      e("t5-e5",  "t5-n5", "t5-n6"),
      eh("t5-e6", "t5-n6", "t5-n7", "pass"),
      e("t5-e7",  "t5-n7", "t5-n8"),
    ],
  },

  // ── 6. Auto-Fix Pipeline ─────────────────────────────────────────────────
  {
    id: "auto-fix-pipeline",
    label: "Auto-Fix Pipeline",
    description: "Validate with dual outputs: pass branch previews immediately, fail branch routes through LoopUntil to auto-fix TypeScript errors then preview",
    nodes: [
      n("t6-n1", "input",     "User Prompt", "Start of workflow",   C.io,          60,  200, { prompt: "Create a reusable Modal component with a title, body slot, close button, and backdrop click-to-dismiss. Include TypeScript props interface." }),
      n("t6-n2", "structure", "Structure",   "Generate TSX",        C.generation,  280, 200),
      n("t6-n3", "validate",  "Validate",    "Run tsc + AI review", C.analysis,    500, 200),
      n("t6-n4", "preview",   "Preview ✓",   "Render clean code",   C.io,          760,  80),
      n("t6-n5", "loopuntil", "Loop Until",  "Auto-fix errors",     C.composition, 760, 320, { validationCommand: "bun tsc --noEmit", maxIterations: 3 }),
      n("t6-n6", "preview",   "Preview ✗",   "Render fixed code",   C.io,          980, 320),
    ],
    edges: [
      e("t6-e1",  "t6-n1", "t6-n2"),
      e("t6-e2",  "t6-n2", "t6-n3"),
      eh("t6-e3", "t6-n3", "t6-n4", "pass"),
      eh("t6-e4", "t6-n3", "t6-n5", "fail"),
      e("t6-e5",  "t6-n5", "t6-n6"),
    ],
  },

];