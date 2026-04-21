// Static data — themes, components, screens, APIs, workflow nodes.

export interface NodeItem {
  type: string;
  label: string;
  desc: string;
  icon: string;
}

export interface NodeCat {
  id: string;
  label: string;
  color: string;
  items: NodeItem[];
}

export interface WorkflowNode {
  id: string;
  type: string;
  x: number;
  y: number;
  label: string;
  subtitle: string;
}

export interface WorkflowEdge {
  from: string;
  to: string;
}

export interface SavedWorkflow {
  id: string;
  name: string;
  desc: string;
  nodes: number;
  edges: number;
  updated: string;
}

export interface Theme {
  id: string;
  name: string;
  desc: string;
  swatches: string[];
  cat: string;
  button: string;
  accent: string;
  dark?: boolean;
}

export interface ComponentItem {
  id: string;
  name: string;
  tag: string;
  updated: string;
}

export interface ScreenItem {
  id: string;
  name: string;
  tag: string;
  updated: string;
}

export interface ApiItem {
  id: string;
  name: string;
  kind: string;
  endpoints: number;
  auth: string;
  updated: string;
}

export const NODE_CATS: NodeCat[] = [
  {
    id: "io", label: "Input / Output", color: "cat-io",
    items: [
      { type: "input",  label: "Input",  desc: "Start of workflow", icon: "input" },
      { type: "output", label: "Output", desc: "End of workflow",   icon: "output" },
    ]
  },
  {
    id: "analysis", label: "Analysis", color: "cat-analysis",
    items: [
      { type: "requirements", label: "Requirements",  desc: "Parse requirements",       icon: "list" },
      { type: "designSystem", label: "Design System", desc: "Apply theme tokens",       icon: "palette" },
      { type: "reference",    label: "Reference",     desc: "Analyze components",       icon: "book" },
    ]
  },
  {
    id: "plan", label: "Planning", color: "cat-plan",
    items: [
      { type: "architect", label: "Architect", desc: "Plan structure", icon: "cube" },
    ]
  },
  {
    id: "gen", label: "Generation", color: "cat-gen",
    items: [
      { type: "structure",   label: "Structure",   desc: "Generate HTML / JSX", icon: "chip" },
      { type: "style",       label: "Style",       desc: "Apply CSS classes",   icon: "sparkles" },
      { type: "interaction", label: "Interaction", desc: "Add state / hooks",   icon: "zap" },
    ]
  },
  {
    id: "comp", label: "Composition", color: "cat-comp",
    items: [
      { type: "parallel",    label: "Parallel",    desc: "Branch execution", icon: "branch" },
      { type: "composition", label: "Composition", desc: "Merge outputs",    icon: "layers" },
    ]
  },
  {
    id: "sandbox", label: "Sandbox", color: "cat-sandbox",
    items: [
      { type: "bash",   label: "Bash",     desc: "Run shell command", icon: "terminal" },
      { type: "fileop", label: "File Ops", desc: "Read / write files", icon: "file" },
      { type: "bun",    label: "Bun Run",  desc: "bun dev / build",   icon: "play" },
    ]
  },
  {
    id: "api", label: "API", color: "cat-api",
    items: [
      { type: "fetch",     label: "Fetch",     desc: "HTTP request",    icon: "send" },
      { type: "auth",      label: "Auth",      desc: "Bearer / OAuth",  icon: "link" },
      { type: "transform", label: "Transform", desc: "Shape response",  icon: "cpu" },
    ]
  },
  {
    id: "valid", label: "Validate", color: "cat-validate",
    items: [
      { type: "preview",  label: "Preview",  desc: "Render preview",  icon: "eye" },
      { type: "validate", label: "Validate", desc: "Sanity checks",   icon: "check" },
    ]
  },
];

export const NODE_LOOKUP: Record<string, NodeItem & { color: string; cat: string }> = {};
NODE_CATS.forEach((c) => c.items.forEach((i) => { NODE_LOOKUP[i.type] = { ...i, color: c.color, cat: c.id }; }));

export const STARTER_NODES: WorkflowNode[] = [
  { id: "n1", type: "input",        x: 40,   y: 280, label: "Input",        subtitle: "Start" },
  { id: "n2", type: "requirements", x: 260,  y: 280, label: "Requirements", subtitle: "Parse spec" },
  { id: "n3", type: "designSystem", x: 490,  y: 280, label: "Design System", subtitle: "Apply theme" },
  { id: "n4", type: "architect",    x: 720,  y: 150, label: "Architect",    subtitle: "Plan layout" },
  { id: "n5", type: "structure",    x: 720,  y: 410, label: "Structure",    subtitle: "HTML / JSX" },
  { id: "n6", type: "style",        x: 960,  y: 280, label: "Style",        subtitle: "Tailwind" },
  { id: "n7", type: "preview",      x: 1190, y: 280, label: "Preview",      subtitle: "Render" },
  { id: "n8", type: "output",       x: 1410, y: 280, label: "Output",       subtitle: "Export" },
];

export const STARTER_EDGES: WorkflowEdge[] = [
  { from: "n1", to: "n2" },
  { from: "n2", to: "n3" },
  { from: "n3", to: "n4" },
  { from: "n3", to: "n5" },
  { from: "n4", to: "n6" },
  { from: "n5", to: "n6" },
  { from: "n6", to: "n7" },
  { from: "n7", to: "n8" },
];

export const SAVED_WORKFLOWS: SavedWorkflow[] = [
  { id: "s1", name: "Simple Component",  desc: "Single focused, single-purpose UI component", nodes: 5, edges: 4, updated: "2d ago" },
  { id: "s2", name: "Screen with Theme", desc: "Apply design system to a generated screen",    nodes: 7, edges: 6, updated: "5h ago" },
  { id: "s3", name: "Multi-screen Flow", desc: "Architect + generate 3 linked screens",         nodes: 11, edges: 14, updated: "1w ago" },
  { id: "s4", name: "API-backed Screen", desc: "Connect a REST API to a generated dashboard",  nodes: 9, edges: 10, updated: "3d ago" },
  { id: "s5", name: "Refine Existing",   desc: "Small targeted update to a saved component",   nodes: 4, edges: 3, updated: "12h ago" },
  { id: "s6", name: "Style Transfer",    desc: "Restyle component with a new theme",           nodes: 6, edges: 5, updated: "1d ago" },
  { id: "s7", name: "Full App Scaffold", desc: "From prompt to bun project with 5 screens",    nodes: 18, edges: 22, updated: "4h ago" },
];

export const LIB_THEMES: Theme[] = [
  { id: "t1", name: "Amber",  desc: "The quick brown fox", swatches: ["#f59e0b","#d97706","#fffbeb","#1f1410"], cat: "shadcn", button: "#f59e0b", accent: "#f59e0b" },
  { id: "t2", name: "Zinc",   desc: "The quick brown fox", swatches: ["#71717a","#3f3f46","#fafafa","#18181b"], cat: "shadcn", button: "#27272a", accent: "#71717a" },
  { id: "t3", name: "Amber Dark", desc: "Warm amber dark",  swatches: ["#f59e0b","#b45309","#fef3c7","#0c0a09"], cat: "shadcn", button: "#f59e0b", accent: "#f59e0b", dark: true },
  { id: "t4", name: "Teal Ink", desc: "Cool teal on ink",   swatches: ["#2dd4bf","#0f766e","#ccfbf1","#042f2e"], cat: "shadcn", button: "#2dd4bf", accent: "#2dd4bf", dark: true },
  { id: "t5", name: "Neo Violet", desc: "Violet accent",    swatches: ["#a78bfa","#7c3aed","#ede9fe","#1e1b3a"], cat: "shadcn", button: "#7c3aed", accent: "#a78bfa", dark: true },
  { id: "t6", name: "Rose",   desc: "Soft rose",            swatches: ["#fb7185","#be123c","#ffe4e6","#1a0a10"], cat: "shadcn", button: "#e11d48", accent: "#fb7185" },
];

export const LIB_COMPONENTS: ComponentItem[] = [
  { id: "c1", name: "Login Card",       tag: "auth",      updated: "2d" },
  { id: "c2", name: "Pricing Table",    tag: "marketing", updated: "1w" },
  { id: "c3", name: "Stats Dashboard",  tag: "data",      updated: "3d" },
  { id: "c4", name: "Settings Panel",   tag: "app",       updated: "5h" },
  { id: "c5", name: "File Uploader",    tag: "form",      updated: "1d" },
  { id: "c6", name: "Chat Bubble",      tag: "social",    updated: "6h" },
  { id: "c7", name: "Kanban Column",    tag: "app",       updated: "8h" },
  { id: "c8", name: "Empty State",      tag: "ui",        updated: "3d" },
];

export const LIB_SCREENS: ScreenItem[] = [
  { id: "sc1", name: "Dashboard",       tag: "app", updated: "2h" },
  { id: "sc2", name: "Login",           tag: "auth", updated: "1d" },
  { id: "sc3", name: "Settings",        tag: "app", updated: "3h" },
  { id: "sc4", name: "Onboarding · 1",  tag: "flow", updated: "4h" },
  { id: "sc5", name: "Onboarding · 2",  tag: "flow", updated: "4h" },
  { id: "sc6", name: "Empty Inbox",     tag: "app", updated: "1w" },
];

export const LIB_APIS: ApiItem[] = [
  { id: "a1", name: "Stripe",       kind: "openapi", endpoints: 48, auth: "Bearer", updated: "1d" },
  { id: "a2", name: "Supabase",     kind: "openapi", endpoints: 23, auth: "Bearer", updated: "2d" },
  { id: "a3", name: "OpenWeather",  kind: "manual",  endpoints: 4,  auth: "API key", updated: "5h" },
  { id: "a4", name: "GitHub",       kind: "openapi", endpoints: 112,auth: "OAuth",  updated: "3d" },
  { id: "a5", name: "Internal /v2", kind: "curl",    endpoints: 8,  auth: "None",   updated: "1h" },
];

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}
