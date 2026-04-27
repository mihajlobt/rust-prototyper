import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type NodeProps,
  BackgroundVariant,
  Panel,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Allotment } from "allotment";
import {
  Play, Square, Save, Trash2, Settings, Undo2, Redo2,
  Plus, X, Copy, FolderOpen, FilePlus, RotateCw,
  LogIn, LogOut, FileOutput, ListChecks, Palette, BookOpen, Compass,
  Layout, Paintbrush, MousePointerClick, GitBranch, Merge,
  Terminal, Globe, Lock, Wand2, ShieldCheck, Eye, Package, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  generateCompletionStream, getApiKeyForProvider, getHostForProvider, httpRequest, runShellCommand,
  readFile, writeFile, createDir, saveWorkflow, loadWorkflow, listWorkflows, bunDev,
  type FileEntry, type CompletionEvent, type Message, type Provider,
} from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import Frame from "react-frame-component";

// ─── Node type definitions ─────────────────────────────────────────────────

import type { LucideIcon } from "lucide-react";

interface NodeTypeDef {
  type: string;
  label: string;
  desc: string;
  category: string;
  color: string;
  icon: LucideIcon;
}

const BUILTIN_NODE_TYPES: NodeTypeDef[] = [
  { type: "input",        label: "Input",         desc: "Start of workflow",       category: "IO",          color: "var(--node-io)",         icon: LogIn },
  { type: "output",       label: "Output",        desc: "End of workflow",         category: "IO",          color: "var(--node-io)",         icon: LogOut },
  { type: "writefile",    label: "Write File",    desc: "Write output to file",    category: "IO",          color: "var(--node-io)",         icon: FileOutput },
  { type: "requirements", label: "Requirements",  desc: "Parse requirements",      category: "Analysis",    color: "var(--node-analysis)",    icon: ListChecks },
  { type: "designSystem", label: "Design System", desc: "Apply theme tokens",      category: "Analysis",    color: "var(--node-analysis)",    icon: Palette },
  { type: "reference",    label: "Reference",     desc: "Analyze components",      category: "Analysis",    color: "var(--node-analysis)",    icon: BookOpen },
  { type: "architect",    label: "Architect",     desc: "Plan structure",          category: "Planning",    color: "var(--node-planning)",    icon: Compass },
  { type: "structure",    label: "Structure",     desc: "Generate HTML/JSX",       category: "Generation",  color: "var(--node-generation)",  icon: Layout },
  { type: "style",        label: "Style",         desc: "Apply CSS classes",       category: "Generation",  color: "var(--node-generation)",  icon: Paintbrush },
  { type: "interaction",  label: "Interaction",   desc: "Add state/hooks",         category: "Generation",  color: "var(--node-terminal)",    icon: MousePointerClick },
  { type: "parallel",     label: "Parallel",      desc: "Branch execution",        category: "Composition", color: "var(--node-composition)", icon: GitBranch },
  { type: "composition",  label: "Composition",   desc: "Merge outputs",           category: "Composition", color: "var(--node-composition)", icon: Merge },
  { type: "bash",         label: "Bash",          desc: "Run shell command",       category: "Utility",     color: "var(--node-utility)",     icon: Terminal },
  { type: "fetch",        label: "Fetch",         desc: "HTTP request",            category: "Utility",     color: "var(--node-utility)",     icon: Globe },
  { type: "fileop",       label: "File Op",       desc: "Read / write files",      category: "Utility",     color: "var(--node-utility)",     icon: FolderOpen },
  { type: "auth",         label: "Auth",          desc: "Authentication header",   category: "Utility",     color: "var(--node-terminal)",    icon: Lock },
  { type: "transform",    label: "Transform",     desc: "Transform content via AI","category": "Utility",    color: "var(--node-utility)",     icon: Wand2 },
  { type: "validate",     label: "Validate",      desc: "Validate code output",    category: "Utility",     color: "var(--node-analysis)",    icon: ShieldCheck },
  { type: "preview",      label: "Preview",       desc: "Render HTML output",      category: "Utility",     color: "var(--node-io)",          icon: Eye },
  { type: "bun",          label: "Bun",           desc: "Bun dev / build",         category: "Utility",     color: "var(--node-utility)",     icon: Package },
  { type: "runner",       label: "Runner",        desc: "Start dev server",        category: "Utility",     color: "var(--node-generation)",  icon: Play },
  { type: "custom",       label: "Custom",        desc: "Custom AI node",          category: "Custom",      color: "var(--node-custom)",      icon: Sparkles },
];

const CATEGORY_ORDER = ["IO", "Analysis", "Planning", "Generation", "Composition", "Utility", "Custom"];

// ─── Custom node data ──────────────────────────────────────────────────────

interface WorkflowNodeData {
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

type WorkflowNodeType = Node<WorkflowNodeData, 'workflow'>;

// ─── Custom node component ─────────────────────────────────────────────────

function WorkflowNode({ data, selected }: NodeProps<WorkflowNodeType>) {
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
      {/* Color accent bar */}
      <div className="wf-accent-bar" style={{ background: d.color }} />

      <Handle type="target" position={Position.Left}  className="wf-handle" style={{ borderColor }} />
      <Handle type="source" position={Position.Right} className="wf-handle" style={{ borderColor }} />

      <div className="px-3 pt-1.5 pb-2">
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

const nodeTypes: NodeTypes = { workflow: WorkflowNode };

function generateId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Main view (needs ReactFlowProvider) ──────────────────────────────────

function WorkflowCanvas() {
  const { settings } = useAppStore();
  const { ps: { activeWorkflow: initialWorkflow } } = useProjectSettingsStore();
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("workflows", 3);
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow<WorkflowNodeType, Edge>();

  const makeNode = useCallback((typeDef: NodeTypeDef, position = { x: 200, y: 200 }): WorkflowNodeType => ({
    id: generateId(),
    type: "workflow",
    position,
    data: {
      label: typeDef.label,
      nodeType: typeDef.type,
      color: typeDef.color,
      desc: typeDef.desc,
      status: "idle",
    } satisfies WorkflowNodeData,
  }), []);

  const defaultColor = (type: string) => allDefs.find((t) => t.type === type)?.color ?? "var(--node-custom)";

  // ── Custom node defs (declared early so allDefs is available for onDrop etc.) ──
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDefs, setCustomDefs] = useState<NodeTypeDef[]>([]);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");
  const allDefs = useMemo(() => [...BUILTIN_NODE_TYPES, ...customDefs], [customDefs]);
  const categories = CATEGORY_ORDER.filter((c) => allDefs.some((t) => t.category === c));

  const handleAddCustomDef = () => {
    if (!customName.trim()) return;
    setCustomDefs((prev) => [...prev, { type: `custom_${Date.now()}`, label: customName.trim(), desc: customDesc.trim() || "Custom AI node", category: "Custom", color: "var(--node-custom)", icon: Sparkles }]);
    setCustomName(""); setCustomDesc(""); setShowCustomForm(false);
  };

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>([
    { id: "n1", type: "workflow", position: { x: 60,  y: 100 }, data: { label: "User Prompt",    nodeType: "input",        color: defaultColor("input"), desc: "Start of workflow", status: "idle", prompt: "Build a login form" } },
    { id: "n2", type: "workflow", position: { x: 280, y: 100 }, data: { label: "Requirements",   nodeType: "requirements", color: defaultColor("requirements"), desc: "Parse requirements", status: "idle" } },
    { id: "n3", type: "workflow", position: { x: 500, y: 100 }, data: { label: "Plan Structure", nodeType: "architect",    color: defaultColor("architect"), desc: "Plan structure",     status: "idle" } },
  ]);

  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([
    { id: "e1-2", source: "n1", target: "n2", type: "smoothstep" },
    { id: "e2-3", source: "n2", target: "n3", type: "smoothstep" },
  ]);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, type: "smoothstep" }, eds));
  }, [setEdges]);

  // Undo/redo
  const MAX_UNDO = 50;
  const undoStack = useRef<Array<{ nodes: WorkflowNodeType[]; edges: Edge[] }>>([]);
  const redoStack = useRef<Array<{ nodes: WorkflowNodeType[]; edges: Edge[] }>>([]);
  const pushUndo = useCallback(() => {
    undoStack.current.push({ nodes: getNodes(), edges: getEdges() });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, [getNodes, getEdges]);

  const handleUndo = useCallback(() => {
    if (!undoStack.current.length) return;
    redoStack.current.push({ nodes: getNodes(), edges: getEdges() });
    const prev = undoStack.current.pop()!;
    setNodes(prev.nodes); setEdges(prev.edges);
  }, [getNodes, getEdges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    if (!redoStack.current.length) return;
    undoStack.current.push({ nodes: getNodes(), edges: getEdges() });
    const next = redoStack.current.pop()!;
    setNodes(next.nodes); setEdges(next.edges);
  }, [getNodes, getEdges, setNodes, setEdges]);

  // Selected node
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;
  const selectedData = selectedNode?.data;

  const updateNodeData = useCallback((id: string, patch: Partial<WorkflowNodeData>) => {
    pushUndo();
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));
  }, [pushUndo, setNodes]);

  const deleteSelected = useCallback(() => {
    if (!selectedNodeId) return;
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== selectedNodeId));
    setEdges((prev) => prev.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId));
    setSelectedNodeId(null);
  }, [selectedNodeId, pushUndo, setNodes, setEdges]);

  const duplicateSelected = useCallback(() => {
    if (!selectedNode) return;
    pushUndo();
    const newNode: WorkflowNodeType = {
      ...selectedNode,
      id: generateId(),
      position: { x: selectedNode.position.x + 40, y: selectedNode.position.y + 40 },
      data: { ...selectedNode.data, status: "idle", output: undefined },
      selected: false,
    };
    setNodes((prev) => [...prev, newNode]);
  }, [selectedNode, pushUndo, setNodes]);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  const onNodeContextMenu = useCallback((e: React.MouseEvent, node: WorkflowNodeType) => {
    e.preventDefault();
    setCtxMenu({ nodeId: node.id, x: e.clientX, y: e.clientY });
    setSelectedNodeId(node.id);
  }, []);

  const onPaneClick = useCallback(() => {
    setCtxMenu(null);
    setSelectedNodeId(null);
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowNodeType) => {
    setSelectedNodeId(node.id);
    setCtxMenu(null);
  }, []);

  // Drag from palette onto canvas
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData("application/workflow-node");
    if (!nodeType) return;
    const typeDef = allDefs.find((t) => t.type === nodeType);
    if (!typeDef) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    pushUndo();
    setNodes((prev) => [...prev, makeNode(typeDef, position)]);
  }, [screenToFlowPosition, pushUndo, setNodes, makeNode, allDefs]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); if (e.shiftKey) { handleRedo(); } else { handleUndo(); } }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId && !["INPUT","TEXTAREA"].includes((e.target as HTMLElement).tagName)) deleteSelected();
      if (e.key === "Escape") setCtxMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo, deleteSelected, selectedNodeId]);

  // ── Execution engine ────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<{ total: number; done: number; errors: number; elapsed: number } | null>(null);
  const abortRef = useRef(false);

  const runWorkflow = async () => {
    setRunning(true);
    setRunSummary(null);
    abortRef.current = false;
    const generatedPath = `projects/${settings.project}/generated`;
    const startTime = Date.now();
    const currentNodes = getNodes();
    const currentEdges = getEdges();

    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle", output: undefined } })));

    const adj  = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const n of currentNodes) { adj.set(n.id, []); radj.set(n.id, []); }
    for (const e of currentEdges) { adj.get(e.source)!.push(e.target); radj.get(e.target)!.push(e.source); }

    const inDeg = new Map<string, number>();
    for (const n of currentNodes) inDeg.set(n.id, 0);
    for (const e of currentEdges) inDeg.set(e.target, inDeg.get(e.target)! + 1);
    const queue = [...inDeg.entries()].filter(([,d]) => d === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!; order.push(id);
      for (const nx of adj.get(id)!) { inDeg.set(nx, inDeg.get(nx)! - 1); if (inDeg.get(nx) === 0) queue.push(nx); }
    }
    const execOrder = order.length === currentNodes.length ? order : currentNodes.map((n) => n.id);
    const compDeps = new Map<string, Set<string>>();
    for (const n of currentNodes) if (n.data.nodeType === "composition") compDeps.set(n.id, new Set(radj.get(n.id)!));

    const getPrevOut = (nodeId: string) => {
      const inc = currentEdges.filter((e) => e.target === nodeId);
      return inc.length ? (currentNodes.find((n) => n.id === inc[0].source)?.data)?.output ?? "" : "";
    };

    const updateStatus = (id: string, patch: Partial<WorkflowNodeData>) =>
      setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

    const execNode = async (nodeId: string) => {
      if (abortRef.current) return;
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const d = node.data;
      updateStatus(nodeId, { status: "running", output: undefined });
      const prevOut = getPrevOut(nodeId);

      try {
        let output = "";
        const promptBase = d.prompt || d.label;
        const model = settings.modelId;
        const host = getHostForProvider(settings.provider as Provider, settings.host);
        const apiKey = getApiKeyForProvider(settings.provider as Provider, settings.apiKeys);
        const customPrompts = settings.prompts;

        const streamAI = async (msgs: Message[]): Promise<string> => {
          const channel = new Channel<CompletionEvent>();
          let acc = "";
          channel.onmessage = (msg) => {
            if (msg.event === "Chunk") { acc += msg.data.text; updateStatus(nodeId, { output: acc }); }
            if (msg.event === "Error") { throw new Error(msg.data.message); }
          };
          await generateCompletionStream(model, msgs, host, apiKey, channel, undefined, undefined, settings.provider as Provider);
          return acc;
        };
        const ai = (sys: string, user: string) => streamAI([{ role: "system", content: sys }, { role: "user", content: user }]);

        const isCustomType = d.nodeType === "custom" || d.nodeType.startsWith("custom_");
        if (isCustomType) {
          output = await ai(d.prompt || "Process the input.", prevOut || promptBase);
        } else switch (d.nodeType) {
          case "input":        output = promptBase; break;
          case "output":       output = prevOut; break;
          case "writefile": {
            const wfPath = d.path && d.path.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "output.txt"}`;
            const wfDir = wfPath.substring(0, wfPath.lastIndexOf("/"));
            try { await createDir(wfDir); } catch { /* dir may exist */ }
            const wfContent = d.mode === "append" ? (await readFile(wfPath).catch(() => "") + "\n" + prevOut) : prevOut;
            await writeFile(wfPath, wfContent);
            output = `Wrote to ${d.path || "output.txt"}`;
            break;
          }
          case "requirements": output = await ai(customPrompts["workflow-requirements-system"] || "Extract and structure requirements as bullet points.", prevOut || promptBase); break;
          case "architect":    output = await ai(customPrompts["workflow-architect-system"]    || "Create a high-level architecture plan.", prevOut || promptBase); break;
          case "structure":    output = await ai(customPrompts["workflow-structure-system"]    || "Generate HTML/JSX. Output only code.", prevOut || promptBase); break;
          case "style":        output = await ai(customPrompts["workflow-style-system"]        || "Apply Tailwind CSS. Output only code.", prevOut || promptBase); break;
          case "interaction":  output = await ai(customPrompts["workflow-interaction-system"]  || "Add React hooks and state. Output only code.", prevOut || promptBase); break;
          case "reference":    output = await ai(customPrompts["workflow-reference-system"]    || "Analyze component references and describe their APIs.", prevOut || promptBase); break;
          case "transform":    output = await ai(customPrompts["workflow-transform-system"]    || "Transform the content per the instruction. Output only transformed content.", `Instruction: ${promptBase}\n\nContent: ${prevOut}`); break;
          case "validate":     output = await ai(customPrompts["workflow-validate-system"]     || "Validate code for errors. If valid, say 'Valid'.", prevOut || "No code to validate"); break;
          case "bash": { await runShellCommand(generatedPath, d.command || "echo hello"); output = `Ran: ${d.command}`; break; }
          case "fetch": {
            let headers: Record<string, string> = {}; try { headers = JSON.parse(d.headers || "{}"); } catch { /* invalid JSON headers */ }
            const res = await httpRequest(d.method || "GET", d.url || "https://api.github.com", headers, d.body || undefined);
            output = `Status: ${res.status}\n${res.body.slice(0, 2000)}`; break;
          }
          case "fileop": {
            const filePath = d.path && d.path.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "test.txt"}`;
            if ((d.operation || "read") === "read") output = (await readFile(filePath)).slice(0, 2000);
            else { await writeFile(filePath, d.content || ""); output = `Wrote to ${d.path}`; } break;
          }
          case "auth": {
            const h: Record<string, string> = {};
            if (d.authScheme === "apikey") h[d.authHeaderName || "X-API-Key"] = d.authToken || "";
            else if (d.authScheme === "basic") h["Authorization"] = `Basic ${btoa(d.authToken || "")}`;
            else h["Authorization"] = `Bearer ${d.authToken || ""}`;
            output = JSON.stringify(h); break;
          }
          case "parallel":    output = `Forked into ${currentEdges.filter((e) => e.source === nodeId).length} branches`; break;
          case "composition": output = currentEdges.filter((e) => e.target === nodeId).map((e) => currentNodes.find((n) => n.id === e.source)?.data?.output || "").join("\n\n---\n\n") || "No inputs"; break;
          case "preview":     output = prevOut || "Nothing to preview"; break;
          case "designSystem": {
            try { const css = await readFile(`projects/${settings.project}/themes/${d.prompt || "default"}/theme.css`); output = `${prevOut ? prevOut + "\n\n" : ""}/* Applied theme: ${d.prompt} */\n${css}`; }
            catch { output = `Theme not found. ${prevOut || ""}`; } break;
          }
          case "bun": { if (d.command === "dev") { await bunDev(generatedPath, 5173); output = "Started bun dev"; } else { await runShellCommand(generatedPath, `bun ${d.command || "build"}`); output = `Ran bun ${d.command}`; } break; }
          case "runner": { const rPort = Number(d.port) || 5173; await bunDev(generatedPath, rPort); output = `Dev server running on :${rPort}`; break; }
          default: output = prevOut || `${d.label} passed through`;
        }

        updateStatus(nodeId, { status: "done", output });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateStatus(nodeId, { status: "error", output: msg });
        notify.error(`Workflow node "${d.label}" failed`, msg);
      }
    };

    const findBranch = (startId: string): string[] => {
      const branch = [startId]; const vis = new Set([startId]);
      const walk = (id: string) => { for (const nx of adj.get(id)!) { if (!vis.has(nx) && currentNodes.find((n) => n.id === nx)?.data?.nodeType !== "composition") { vis.add(nx); branch.push(nx); walk(nx); } } };
      walk(startId); return branch;
    };

    const done = new Set<string>();
    const checkComp = async () => {
      for (const [cid, deps] of compDeps) if (!done.has(cid) && [...deps].every((d) => done.has(d))) { await execNode(cid); done.add(cid); }
    };

    for (const nodeId of execOrder) {
      if (abortRef.current) break;
      const nd = currentNodes.find((n) => n.id === nodeId);
      if (!nd || done.has(nodeId)) continue;
      const nType = nd.data.nodeType;
      if (nType === "composition") { const deps = radj.get(nodeId)!; if (!deps.every((d) => done.has(d))) continue; }
      if (nType === "parallel") {
        await execNode(nodeId); done.add(nodeId);
        await Promise.all(adj.get(nodeId)!.map(async (childId) => { for (const bid of findBranch(childId)) { if (!done.has(bid)) { await execNode(bid); done.add(bid); } } }));
        await checkComp();
      } else {
        await execNode(nodeId); done.add(nodeId); await checkComp();
      }
    }
    for (const [cid, deps] of compDeps) if (!done.has(cid) && [...deps].some((d) => done.has(d))) { await execNode(cid); done.add(cid); }
    const finalNodes = getNodes();
    const errorCount = finalNodes.filter((n) => n.data.status === "error").length;
    const doneCount = finalNodes.filter((n) => n.data.status === "done").length;
    setRunSummary({ total: currentNodes.length, done: doneCount, errors: errorCount, elapsed: Date.now() - startTime });
    setRunning(false);
  };

  const stopWorkflow = () => {
    abortRef.current = true; setRunning(false);
    setNodes((prev) => prev.map((n) => n.data.status === "running" ? { ...n, data: { ...n.data, status: "idle" } } : n));
  };

  // ── Save / load ─────────────────────────────────────────────────────────
  const [workflowId, setWorkflowId] = useState("default");
  const [savedWorkflows, setSavedWorkflows] = useState<FileEntry[]>([]);
  const [showWorkflowsPanel, setShowWorkflowsPanel] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);

  const refreshSavedWorkflows = useCallback(async () => {
    try { setSavedWorkflows(await listWorkflows(settings.project)); } catch { setSavedWorkflows([]); }
  }, [settings.project]);

  useEffect(() => { refreshSavedWorkflows(); }, [refreshSavedWorkflows]);

  const handleLoad = useCallback(async (id: string) => {
    setSaveError(null);
    try {
      const data = await loadWorkflow(settings.project, id.replace(".json", ""));
      const parsed = JSON.parse(data);
      if (parsed.nodes) setNodes(parsed.nodes);
      if (parsed.edges) setEdges(parsed.edges);
      setWorkflowId(id.replace(".json", ""));
      setShowWorkflowsPanel(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      notify.error("Failed to load workflow", msg);
    }
  }, [settings.project, setNodes, setEdges]);

  useEffect(() => {
    if (!initialWorkflow) return;
    handleLoad(initialWorkflow);
  }, [initialWorkflow, handleLoad]);

  const handleSave = async () => {
    setSaveError(null);
    try {
      const id = workflowId.trim() || "default";
      setWorkflowId(id);
      await saveWorkflow(settings.project, id, JSON.stringify({ nodes: getNodes(), edges: getEdges() }, null, 2));
      await refreshSavedWorkflows();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      notify.error("Failed to save workflow", msg);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const { deleteFile } = await import("@/lib/ipc");
      await deleteFile(`projects/${settings.project}/workflows/${name}`);
      await refreshSavedWorkflows();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg);
      notify.error("Failed to delete workflow", msg);
    }
    setDeleteConfirm(null);
  };

  const handleNew = () => {
    pushUndo();
    setNodes([{ id: "n1", type: "workflow", position: { x: 100, y: 100 }, data: { label: "Input", nodeType: "input", color: defaultColor("input"), desc: "Start of workflow", status: "idle" } }]);
    setEdges([]);
    setWorkflowId(`workflow-${Date.now()}`);
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" onClick={() => setCtxMenu(null)}>
      {/* Toolbar */}
      <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
        <Button variant={running ? "destructive" : "default"} size="sm" className="h-7 text-xs gap-1" onClick={running ? stopWorkflow : runWorkflow}>
          {running ? <><Square size={12} />Stop</> : <><Play size={12} />Run</>}
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleUndo} title="Undo"><Undo2 size={12} /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRedo} title="Redo"><Redo2 size={12} /></Button>
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground truncate max-w-[120px] hidden sm:block">{workflowId}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="New workflow" onClick={handleNew}><FilePlus size={12} /></Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSave}><Save size={12} />Save</Button>
        <Button variant={showWorkflowsPanel ? "secondary" : "outline"} size="sm" className="h-7 text-xs gap-1" onClick={() => setShowWorkflowsPanel((v) => !v)}>
          <FolderOpen size={12} />Workflows
        </Button>
      </div>

      {runSummary && (
        <div className="flex items-center gap-3 px-3 py-1.5 text-[10px] bg-muted/50 border-b border-border">
          <span>{runSummary.done}/{runSummary.total} done</span>
          {runSummary.errors > 0 && <span className="text-destructive">{runSummary.errors} errors</span>}
          <span className="text-muted-foreground">{runSummary.elapsed}ms</span>
        </div>
      )}

      <div className="flex-1 overflow-hidden relative">
        <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
          {/* Palette */}
          <Allotment.Pane preferredSize={200} minSize={160}>
            <div className="h-full border-r border-border bg-card overflow-auto">
              <div className="p-2 border-b border-border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-0.5">Node Palette</div>
                <div className="text-[10px] text-muted-foreground px-1">Drag onto canvas or click to add</div>
              </div>
              <div className="p-2 space-y-3">
                {categories.map((cat) => (
                  <div key={cat}>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">{cat}</div>
                    <div className="space-y-0.5">
                      {allDefs.filter((t) => t.category === cat).map((t) => (
                        <div
                          key={t.type}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData("application/workflow-node", t.type)}
                          onClick={() => {
                            pushUndo();
                            setNodes((prev) => [...prev, makeNode(t, { x: 100 + prev.length * 30, y: 100 + prev.length * 30 })]);
                          }}
                          className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-muted cursor-grab active:cursor-grabbing transition-colors"
                        >
                          <t.icon size={14} className="mt-0.5 shrink-0" style={{ color: t.color }} />
                          <div className="min-w-0">
                            <div className="text-xs font-medium leading-tight">{t.label}</div>
                            <div className="text-[10px] text-muted-foreground leading-tight">{t.desc}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">Custom</div>
                  {!showCustomForm ? (
                    <button onClick={() => setShowCustomForm(true)} className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded border border-dashed border-border hover:border-primary hover:text-primary transition-colors">
                      <Plus size={10} />Add custom node type
                    </button>
                  ) : (
                    <div className="space-y-1.5 p-2 bg-muted rounded">
                      <Input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Node name" className="h-6 text-xs" autoFocus />
                      <Input value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} placeholder="Description" className="h-6 text-xs" />
                      <div className="flex gap-1">
                        <Button size="sm" className="h-6 text-xs flex-1" onClick={handleAddCustomDef} disabled={!customName.trim()}>Add</Button>
                        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setShowCustomForm(false)}><X size={10} /></Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Allotment.Pane>

          {/* React Flow canvas */}
          <Allotment.Pane>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              onNodeContextMenu={onNodeContextMenu}
              onPaneClick={onPaneClick}
              onDrop={onDrop}
              onDragOver={onDragOver}
              nodeTypes={nodeTypes}
              fitView
              snapToGrid
              snapGrid={[16, 16]}
              defaultEdgeOptions={{ type: "smoothstep", animated: false }}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
              className="bg-muted/10"
            >
              <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="opacity-30" />
              <Controls />
              <MiniMap<WorkflowNodeType>
                nodeColor={(n) => n.data.color || "var(--node-custom)"}
                className="!bg-card !border-border rounded-lg overflow-hidden"
                maskColor="rgba(0,0,0,0.2)"
              />
              {nodes.length === 0 && (
                <Panel position="top-center">
                  <div className="text-muted-foreground text-xs mt-8">Drag nodes from the palette or click to add</div>
                </Panel>
              )}
            </ReactFlow>
          </Allotment.Pane>

          {/* Properties panel */}
          <Allotment.Pane preferredSize={260} minSize={200}>
            {selectedData ? (
              <div className="h-full border-l border-border bg-card p-3 space-y-3 overflow-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2"><Settings size={14} /><span className="text-sm font-medium">Properties</span></div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={duplicateSelected} title="Duplicate"><Copy size={11} /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={deleteSelected} title="Delete"><Trash2 size={12} className="text-destructive" /></Button>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input value={selectedData.label} onChange={(e) => updateNodeData(selectedNodeId!, { label: e.target.value })} className="h-7 text-xs" />
                </div>

                {(selectedData.nodeType === "input" || selectedData.nodeType === "custom" || selectedData.nodeType.startsWith("custom_")) && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{selectedData.nodeType !== "input" ? "System Prompt" : "Prompt"}</label>
                    <Textarea value={selectedData.prompt || ""} onChange={(e) => updateNodeData(selectedNodeId!, { prompt: e.target.value })} className="text-xs min-h-[80px] resize-none" placeholder="Enter prompt…" />
                  </div>
                )}
                {selectedData.nodeType === "bash" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Command</label><Input value={selectedData.command || ""} onChange={(e) => updateNodeData(selectedNodeId!, { command: e.target.value })} className="h-7 text-xs" placeholder="echo hello" /></div>
                )}
                {selectedData.nodeType === "writefile" && (<>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Path (relative to generated/)</label><Input value={selectedData.path || ""} onChange={(e) => updateNodeData(selectedNodeId!, { path: e.target.value })} className="h-7 text-xs" placeholder="src/App.tsx" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Mode</label>
                    <select value={String(selectedData.mode ?? "overwrite")} onChange={(e) => updateNodeData(selectedNodeId!, { mode: e.target.value })} className="h-7 text-xs w-full rounded-md border border-border bg-card px-2">
                      <option value="overwrite">Overwrite</option>
                      <option value="append">Append</option>
                    </select>
                  </div>
                </>)}
                {selectedData.nodeType === "fetch" && (<>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">URL</label><Input value={selectedData.url || ""} onChange={(e) => updateNodeData(selectedNodeId!, { url: e.target.value })} className="h-7 text-xs" placeholder="https://api.example.com" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Method</label><Input value={selectedData.method || "GET"} onChange={(e) => updateNodeData(selectedNodeId!, { method: e.target.value })} className="h-7 text-xs" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Headers (JSON)</label><Textarea value={selectedData.headers || "{}"} onChange={(e) => updateNodeData(selectedNodeId!, { headers: e.target.value })} className="text-xs min-h-[60px] resize-none font-mono" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Body</label><Textarea value={selectedData.body || ""} onChange={(e) => updateNodeData(selectedNodeId!, { body: e.target.value })} className="text-xs min-h-[60px] resize-none" /></div>
                </>)}
                {selectedData.nodeType === "fileop" && (<>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Operation</label><Input value={selectedData.operation || "read"} onChange={(e) => updateNodeData(selectedNodeId!, { operation: e.target.value })} className="h-7 text-xs" placeholder="read or write" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Path</label><Input value={selectedData.path || ""} onChange={(e) => updateNodeData(selectedNodeId!, { path: e.target.value })} className="h-7 text-xs" placeholder="./file.txt" /></div>
                  {selectedData.operation === "write" && <div className="space-y-1"><label className="text-xs text-muted-foreground">Content</label><Textarea value={selectedData.content || ""} onChange={(e) => updateNodeData(selectedNodeId!, { content: e.target.value })} className="text-xs min-h-[60px] resize-none" /></div>}
                </>)}
                {selectedData.nodeType === "auth" && (<>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Scheme</label><Input value={selectedData.authScheme || "bearer"} onChange={(e) => updateNodeData(selectedNodeId!, { authScheme: e.target.value })} className="h-7 text-xs" placeholder="bearer / apikey / basic" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Token / Key</label><Input value={selectedData.authToken || ""} onChange={(e) => updateNodeData(selectedNodeId!, { authToken: e.target.value })} className="h-7 text-xs" /></div>
                  {selectedData.authScheme === "apikey" && <div className="space-y-1"><label className="text-xs text-muted-foreground">Header Name</label><Input value={selectedData.authHeaderName || "X-API-Key"} onChange={(e) => updateNodeData(selectedNodeId!, { authHeaderName: e.target.value })} className="h-7 text-xs" /></div>}
                </>)}
                {selectedData.nodeType === "transform" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Transform Instruction</label><Textarea value={selectedData.prompt || ""} onChange={(e) => updateNodeData(selectedNodeId!, { prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Convert to TypeScript…" /></div>
                )}
                {selectedData.nodeType === "designSystem" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Theme Name</label><Input value={selectedData.prompt || ""} onChange={(e) => updateNodeData(selectedNodeId!, { prompt: e.target.value })} className="h-7 text-xs" placeholder="default, dark, light…" /></div>
                )}
                {selectedData.nodeType === "bun" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Bun Command</label><Input value={selectedData.command || "dev"} onChange={(e) => updateNodeData(selectedNodeId!, { command: e.target.value })} className="h-7 text-xs" placeholder="dev, build, install" /></div>
                )}
                {selectedData.nodeType === "runner" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Port</label><Input value={String(selectedData.port ?? "5173")} onChange={(e) => updateNodeData(selectedNodeId!, { port: e.target.value })} className="h-7 text-xs" placeholder="5173" /></div>
                )}
                {["requirements","architect","structure","style","interaction","reference","validate"].includes(selectedData.nodeType) && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Context Override</label><Textarea value={selectedData.prompt || ""} onChange={(e) => updateNodeData(selectedNodeId!, { prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Override input from previous node…" /></div>
                )}
                {selectedData.nodeType === "preview" && selectedData.output && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Preview</label><div className="border border-border rounded overflow-hidden bg-white" style={{ height: 200 }}><Frame className="w-full h-full border-0"><div dangerouslySetInnerHTML={{ __html: selectedData.output }} /></Frame></div></div>
                )}

                <div className="pt-2 border-t border-border">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Status</div>
                  <div className="flex items-center gap-1.5">
                    <span className={["w-1.5 h-1.5 rounded-full", selectedData.status === "done" ? "bg-status-done" : selectedData.status === "error" ? "bg-status-error" : selectedData.status === "running" ? "bg-status-running animate-pulse" : "bg-muted-foreground"].join(" ")} />
                    <span className="text-xs capitalize">{selectedData.status || "idle"}</span>
                  </div>
                  {selectedData.output && <div className="mt-2 text-[10px] text-muted-foreground bg-muted p-1.5 rounded whitespace-pre-wrap font-mono overflow-y-auto flex-1 min-h-0">{selectedData.output}</div>}
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs gap-2 border-l border-border">
                <Settings size={20} className="opacity-30" />
                <span>Select a node to edit</span>
              </div>
            )}
          </Allotment.Pane>
        </Allotment>

        {/* Context menu */}
        {ctxMenu && (
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[150px] text-xs"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => { duplicateSelected(); setCtxMenu(null); }}><Copy size={11} />Duplicate</button>
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => {
              if (!ctxMenu) return;
              pushUndo();
              setEdges((prev) => prev.filter((e) => e.source !== ctxMenu.nodeId && e.target !== ctxMenu.nodeId));
              setCtxMenu(null);
            }}><X size={11} />Disconnect edges</button>
            <div className="my-1 h-px bg-border" />
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted text-destructive flex items-center gap-2" onClick={() => { deleteSelected(); setCtxMenu(null); }}><Trash2 size={11} />Delete node</button>
          </div>
        )}

        {/* Workflows panel */}
        {showWorkflowsPanel && (
          <div className="absolute top-0 right-0 h-full w-[260px] bg-card border-l border-border z-40 flex flex-col shadow-xl">
            <div className="panel-toolbar h-10 px-3 gap-2">
              <FolderOpen size={14} />
              <span className="text-sm font-medium flex-1">Saved Workflows</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={refreshSavedWorkflows}><RotateCw size={11} /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowWorkflowsPanel(false)}><X size={12} /></Button>
            </div>
            <div className="p-2 border-b border-border space-y-1.5">
              <div className="flex gap-1">
                <Input value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} placeholder="Workflow name…" className="h-7 text-xs flex-1" onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }} />
                <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={handleSave}><Save size={11} />Save</Button>
              </div>
              <p className="text-[10px] text-muted-foreground px-0.5">{nodes.length} nodes · {edges.length} edges</p>
              {saveError && <p className="text-[10px] text-destructive px-0.5 break-all">{saveError}</p>}
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
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
                  <div key={wf.path} className={["rounded-md border transition-colors", isActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"].join(" ")}>
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{name}</div>
                        {isActive && <div className="text-[10px] text-primary">currently loaded</div>}
                      </div>
                      {!isConfirm ? (
                        <div className="flex gap-0.5 shrink-0">
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleLoad(wf.name)}>Load</Button>
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirm(wf.name)}><Trash2 size={10} /></Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 shrink-0">
                          <Button variant="destructive" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleDelete(wf.name)}>Delete</Button>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="p-2 border-t border-border">
              <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1" onClick={handleNew}><FilePlus size={11} />New blank workflow</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowsView() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}
