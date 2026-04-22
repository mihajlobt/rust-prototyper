import { useState, useRef, useCallback, useEffect } from "react";
import { Allotment } from "allotment";
import { Play, Square, ZoomIn, ZoomOut, Save, Trash2, Settings, Undo2, Redo2, Plus, X, Copy, FolderOpen, FilePlus, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateCompletionStream, getApiKey, httpRequest, runShellCommand, readFile, writeFile, saveWorkflow, loadWorkflow, listWorkflows, bunDev, type FileEntry, type CompletionEvent, type Message } from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useSettings } from "@/hooks/useSettings";

const MAX_UNDO = 50;
const NODE_W = 160;
const NODE_H = 60;

interface NodeData {
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
}

interface Node {
  id: string;
  type: string;
  x: number;
  y: number;
  label: string;
  status?: "idle" | "running" | "done" | "error";
  output?: string;
  data?: NodeData;
}

interface Edge {
  from: string;
  to: string;
}

interface NodeTypeDef {
  type: string;
  label: string;
  desc: string;
  category: string;
  color: string;
}

const NODE_TYPES: NodeTypeDef[] = [
  { type: "input",       label: "Input",        desc: "Start of workflow",      category: "IO",          color: "#3b82f6" },
  { type: "output",      label: "Output",       desc: "End of workflow",        category: "IO",          color: "#3b82f6" },
  { type: "requirements",label: "Requirements", desc: "Parse requirements",     category: "Analysis",    color: "#8b5cf6" },
  { type: "designSystem",label: "Design System",desc: "Apply theme tokens",     category: "Analysis",    color: "#f472b6" },
  { type: "reference",   label: "Reference",    desc: "Analyze components",     category: "Analysis",    color: "#8b5cf6" },
  { type: "architect",   label: "Architect",    desc: "Plan structure",         category: "Planning",    color: "#10b981" },
  { type: "structure",   label: "Structure",    desc: "Generate HTML/JSX",      category: "Generation",  color: "#f59e0b" },
  { type: "style",       label: "Style",        desc: "Apply CSS classes",      category: "Generation",  color: "#ec4899" },
  { type: "interaction", label: "Interaction",  desc: "Add state/hooks",        category: "Generation",  color: "#6366f1" },
  { type: "parallel",    label: "Parallel",     desc: "Branch execution",       category: "Composition", color: "#f97316" },
  { type: "composition", label: "Composition",  desc: "Merge outputs",          category: "Composition", color: "#14b8a6" },
  { type: "bash",        label: "Bash",         desc: "Run shell command",      category: "Utility",     color: "#64748b" },
  { type: "fetch",       label: "Fetch",        desc: "HTTP request",           category: "Utility",     color: "#06b6d4" },
  { type: "fileop",      label: "File Op",      desc: "Read / write files",     category: "Utility",     color: "#d946ef" },
  { type: "auth",        label: "Auth",         desc: "Authentication header",  category: "Utility",     color: "#ef4444" },
  { type: "transform",   label: "Transform",    desc: "Transform content via AI","category": "Utility",  color: "#a855f7" },
  { type: "validate",    label: "Validate",     desc: "Validate code output",   category: "Utility",     color: "#22c55e" },
  { type: "preview",     label: "Preview",      desc: "Render HTML output",     category: "Utility",     color: "#84cc16" },
  { type: "bun",         label: "Bun",          desc: "Bun dev / build",        category: "Utility",     color: "#fbbf24" },
];

function generateNodeId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const CATEGORY_ORDER = ["IO", "Analysis", "Planning", "Generation", "Composition", "Utility", "Custom"];

export function WorkflowsView() {
  const [nodes, setNodes] = useState<Node[]>([
    { id: "n1", type: "input",        x: 60,  y: 140, label: "User Prompt",       status: "idle", data: { prompt: "Build a login form" } },
    { id: "n2", type: "requirements", x: 280, y: 140, label: "Requirements",      status: "idle" },
    { id: "n3", type: "architect",    x: 500, y: 140, label: "Plan Structure",    status: "idle" },
  ]);
  const [edges, setEdges] = useState<Edge[]>([
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 40, y: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const { settings } = useSettings();
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState("default");
  const [savedWorkflows, setSavedWorkflows] = useState<FileEntry[]>([]);
  const [showWorkflowsPanel, setShowWorkflowsPanel] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0 });

  // Connection drawing state
  const [connecting, setConnecting] = useState<{ fromNodeId: string; x: number; y: number } | null>(null);
  const mouseCanvasPos = useRef({ x: 0, y: 0 });

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);

  // Custom node creation
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customDefs, setCustomDefs] = useState<NodeTypeDef[]>([]);
  const [customName, setCustomName] = useState("");
  const [customDesc, setCustomDesc] = useState("");

  // Undo/redo
  const undoStack = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);
  const redoStack = useRef<Array<{ nodes: Node[]; edges: Edge[] }>>([]);

  const pushUndo = useCallback(() => {
    undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    if (undoStack.current.length > MAX_UNDO) undoStack.current.shift();
    redoStack.current = [];
  }, [nodes, edges]);

  const handleUndo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    const prev = undoStack.current.pop()!;
    setNodes(prev.nodes);
    setEdges(prev.edges);
  }, [nodes, edges]);

  const handleRedo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push({ nodes: [...nodes], edges: [...edges] });
    const next = redoStack.current.pop()!;
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [nodes, edges]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
      if (e.key === "Escape") { setCtxMenu(null); setConnecting(null); }
      if ((e.key === "Delete" || e.key === "Backspace") && selectedNodeId && !["INPUT","TEXTAREA"].includes((e.target as HTMLElement).tagName)) {
        deleteNode(selectedNodeId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleUndo, handleRedo, selectedNodeId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const updateNode = useCallback((id: string, patch: Partial<Node>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const updateNodeData = useCallback((id: string, dataPatch: Partial<NodeData>) => {
    pushUndo();
    setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...dataPatch } } : n));
  }, [pushUndo]);

  // Port positions
  const outPort = (node: Node) => ({ x: node.x + NODE_W, y: node.y + NODE_H / 2 });
  const inPort  = (node: Node) => ({ x: node.x,          y: node.y + NODE_H / 2 });

  const toCanvasCoords = useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top  - pan.y) / zoom,
    };
  }, [pan, zoom]);

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    setCtxMenu(null);
    setSelectedNodeId(nodeId);
    setDragging(nodeId);
  };

  const handleOutputPortMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const pos = toCanvasCoords(e.clientX, e.clientY);
    setConnecting({ fromNodeId: nodeId, x: pos.x, y: pos.y });
    setDragging(null);
  };

  const handleInputPortMouseUp = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (!connecting || connecting.fromNodeId === nodeId) { setConnecting(null); return; }
    pushUndo();
    setEdges((prev) => {
      if (prev.some((ed) => ed.from === connecting.fromNodeId && ed.to === nodeId)) return prev;
      return [...prev, { from: connecting.fromNodeId, to: nodeId }];
    });
    setConnecting(null);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const isCanvas = e.target === canvasRef.current || (e.target as HTMLElement).classList.contains("canvas-bg");
    if (isCanvas) {
      setPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setSelectedNodeId(null);
      setCtxMenu(null);
    }
  };

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return;
    const pos = toCanvasCoords(e.clientX, e.clientY);
    mouseCanvasPos.current = pos;
    if (connecting) {
      setConnecting((c) => c ? { ...c, x: pos.x, y: pos.y } : null);
      return;
    }
    if (panning) {
      setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (dragging) {
      setNodes((prev) => prev.map((n) => n.id === dragging ? { ...n, x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 } : n));
    }
  }, [dragging, panning, connecting, toCanvasCoords]);

  const handleMouseUp = () => {
    if (connecting) setConnecting(null);
    setDragging(null);
    setPanning(false);
  };

  const handleNodeRightClick = (e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ nodeId, x: e.clientX, y: e.clientY });
    setSelectedNodeId(nodeId);
  };

  const handleEdgeClick = (e: React.MouseEvent, from: string, to: string) => {
    e.stopPropagation();
    pushUndo();
    setEdges((prev) => prev.filter((ed) => !(ed.from === from && ed.to === to)));
  };

  const handleCanvasWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.08 : 0.08;
    setZoom((z) => Math.min(2, Math.max(0.25, z + delta)));
  };

  const addNode = (type: string, customDef?: NodeTypeDef) => {
    pushUndo();
    const def = customDef || NODE_TYPES.find((t) => t.type === type) || { label: type, color: "#94a3b8" } as NodeTypeDef;
    const pos = toCanvasCoords(
      (canvasRef.current?.getBoundingClientRect().width || 600) / 2,
      (canvasRef.current?.getBoundingClientRect().height || 400) / 2,
    );
    setNodes((prev) => [...prev, {
      id: generateNodeId(), type,
      x: pos.x - NODE_W / 2 + (Math.random() - 0.5) * 60,
      y: pos.y - NODE_H / 2 + (Math.random() - 0.5) * 60,
      label: def.label, status: "idle", data: {},
    }]);
  };

  const deleteNode = (id: string) => {
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
    setCtxMenu(null);
  };

  const duplicateNode = (id: string) => {
    pushUndo();
    const src = nodes.find((n) => n.id === id);
    if (!src) return;
    setNodes((prev) => [...prev, { ...src, id: generateNodeId(), x: src.x + 40, y: src.y + 40, status: "idle", output: undefined }]);
    setCtxMenu(null);
  };

  const disconnectNode = (id: string) => {
    pushUndo();
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    setCtxMenu(null);
  };

  // ── Execution engine (unchanged) ──────────────────────────────────────────
  const runWorkflow = async () => {
    setRunning(true);
    abortRef.current = false;
    setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" as const, output: undefined })));
    const currentNodes = nodes;
    const currentEdges = edges;
    const adj = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const n of currentNodes) { adj.set(n.id, []); radj.set(n.id, []); }
    for (const e of currentEdges) { adj.get(e.from)!.push(e.to); radj.get(e.to)!.push(e.from); }
    const inDegree = new Map<string, number>();
    for (const n of currentNodes) inDegree.set(n.id, 0);
    for (const e of currentEdges) inDegree.set(e.to, inDegree.get(e.to)! + 1);
    const queue: string[] = [];
    for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!; order.push(id);
      for (const next of adj.get(id)!) { inDegree.set(next, inDegree.get(next)! - 1); if (inDegree.get(next) === 0) queue.push(next); }
    }
    const executionOrder = order.length === currentNodes.length ? order : currentNodes.map((n) => n.id);
    const compositionDeps = new Map<string, Set<string>>();
    for (const n of currentNodes) if (n.type === "composition") compositionDeps.set(n.id, new Set(radj.get(n.id)!));
    const getPrevOutput = (nodeId: string): string => {
      const incoming = currentEdges.filter((e) => e.to === nodeId);
      if (incoming.length === 0) return "";
      return currentNodes.find((n) => n.id === incoming[0].from)?.output || "";
    };
    const customPrompts = settings.prompts;
    const executeNode = async (nodeId: string) => {
      if (abortRef.current) return;
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) return;
      updateNode(nodeId, { status: "running", output: undefined });
      const prevOutput = getPrevOutput(nodeId);
      try {
        let output = "";
        const promptBase = node.data?.prompt || node.label;
        const model = settings.modelId;
        const host = settings.host;
        const apiKey = getApiKey(model, settings.apiKeys);
        const streamAI = async (msgs: Message[]): Promise<string> => {
          const channel = new Channel<CompletionEvent>();
          let accumulated = "";
          channel.onmessage = (msg: CompletionEvent) => {
            if (msg.event === "Chunk") { accumulated += msg.data.text; updateNode(nodeId, { output: accumulated.slice(0, 500) }); }
          };
          await generateCompletionStream(model, msgs, host, apiKey, channel);
          return accumulated;
        };
        switch (node.type) {
          case "input": output = promptBase; break;
          case "requirements": output = await streamAI([{ role: "system", content: customPrompts["workflow-requirements-system"] || "Extract and structure requirements. Output as bullet points." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "architect":    output = await streamAI([{ role: "system", content: customPrompts["workflow-architect-system"]    || "Create a high-level architecture plan." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "structure":    output = await streamAI([{ role: "system", content: customPrompts["workflow-structure-system"]    || "Generate HTML/JSX structure. Output only code." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "style":        output = await streamAI([{ role: "system", content: customPrompts["workflow-style-system"]        || "Apply Tailwind CSS. Output only the styled code." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "interaction":  output = await streamAI([{ role: "system", content: customPrompts["workflow-interaction-system"]  || "Add React hooks and state. Output only code." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "transform":    output = await streamAI([{ role: "system", content: customPrompts["workflow-transform-system"]    || "Transform the provided content according to the instruction." }, { role: "user", content: `Instruction: ${promptBase}\n\nContent: ${prevOutput}` }]); break;
          case "validate":     output = await streamAI([{ role: "system", content: customPrompts["workflow-validate-system"]     || "Validate the provided code. List any issues. If valid, say 'Valid'." }, { role: "user", content: prevOutput || "No code to validate" }]); break;
          case "reference":    output = await streamAI([{ role: "system", content: customPrompts["workflow-reference-system"]    || "Analyze the component references and describe their APIs." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "custom":       output = await streamAI([{ role: "system", content: node.data?.prompt || "Process the input." }, { role: "user", content: prevOutput || promptBase }]); break;
          case "bash": { const cmd = node.data?.command || "echo 'No command'"; await runShellCommand(".", cmd); output = `Executed: ${cmd}`; break; }
          case "fetch": { const url = node.data?.url || "https://api.github.com"; const method = node.data?.method || "GET"; let headers: Record<string,string> = {}; try { headers = JSON.parse(node.data?.headers || "{}"); } catch {} const res = await httpRequest(method, url, headers, node.data?.body || undefined); output = `Status: ${res.status}\n${res.body.slice(0,2000)}`; break; }
          case "fileop": { const op = node.data?.operation || "read"; const path = node.data?.path || "./test.txt"; if (op === "read") { output = (await readFile(path)).slice(0,2000); } else { await writeFile(path, node.data?.content || ""); output = `Wrote to ${path}`; } break; }
          case "parallel": { output = `Forked into ${currentEdges.filter((e) => e.from === nodeId).length} branches`; break; }
          case "composition": { const incoming = currentEdges.filter((e) => e.to === nodeId); output = incoming.map((e) => currentNodes.find((n) => n.id === e.from)?.output || "").join("\n\n---\n\n") || "No inputs to compose"; break; }
          case "auth": { const scheme = node.data?.authScheme || "bearer"; const token = node.data?.authToken || "token"; let h: Record<string,string> = {}; if (scheme === "bearer" || scheme === "oauth2") h["Authorization"] = `Bearer ${token}`; else if (scheme === "apikey") h[node.data?.authHeaderName || "X-API-Key"] = token; else if (scheme === "basic") h["Authorization"] = `Basic ${btoa(token)}`; output = JSON.stringify(h); break; }
          case "preview": { output = prevOutput || "Nothing to preview"; break; }
          case "designSystem": { const tn = node.data?.prompt || "default"; try { const css = await readFile(`projects/${settings.project}/themes/${tn}/theme.css`); output = `${prevOutput ? prevOutput+"\n\n" : ""}/* Applied theme: ${tn} */\n${css}`; } catch { output = `Theme "${tn}" not found. ${prevOutput||""}`; } break; }
          case "bun": { const cmd = node.data?.command || "dev"; if (cmd === "dev") { await bunDev(".", 5173); output = "Started bun dev on port 5173"; } else { await runShellCommand(".", `bun ${cmd}`); output = `Ran bun ${cmd}`; } break; }
          default: output = prevOutput || `${node.label} passed through`;
        }
        updateNode(nodeId, { status: "done", output: output.slice(0, 500) });
      } catch (e) {
        updateNode(nodeId, { status: "error", output: String(e).slice(0, 500) });
      }
    };
    const findBranchEnd = (startId: string): string[] => {
      const branch: string[] = [startId]; const visited = new Set<string>([startId]);
      const walk = (id: string) => { for (const next of adj.get(id)!) { if (visited.has(next) || currentNodes.find((n)=>n.id===next)?.type==="composition") continue; visited.add(next); branch.push(next); walk(next); } };
      walk(startId); return branch;
    };
    const completed = new Set<string>();
    for (const nodeId of executionOrder) {
      if (abortRef.current) break;
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) continue;
      if (node.type === "composition") { const deps = radj.get(nodeId)!; if (!deps.every((d) => completed.has(d))) continue; }
      if (node.type === "parallel") {
        await executeNode(nodeId); completed.add(nodeId);
        await Promise.all(adj.get(nodeId)!.map(async (childId) => { for (const bid of findBranchEnd(childId)) { if (!completed.has(bid)) { await executeNode(bid); completed.add(bid); } } }));
        for (const compId of compositionDeps.keys()) { const deps = compositionDeps.get(compId)!; if (deps.size > 0 && [...deps].every((d) => completed.has(d)) && !completed.has(compId)) { await executeNode(compId); completed.add(compId); } }
        continue;
      }
      if (!completed.has(nodeId)) {
        await executeNode(nodeId); completed.add(nodeId);
        for (const compId of compositionDeps.keys()) { const deps = compositionDeps.get(compId)!; if (deps.size > 0 && [...deps].every((d) => completed.has(d)) && !completed.has(compId)) { await executeNode(compId); completed.add(compId); } }
      }
    }
    for (const compId of compositionDeps.keys()) { if (!completed.has(compId)) { const deps = compositionDeps.get(compId)!; if ([...deps].some((d) => completed.has(d))) { await executeNode(compId); completed.add(compId); } } }
    setRunning(false);
  };

  const stopWorkflow = () => {
    abortRef.current = true; setRunning(false);
    setNodes((prev) => prev.map((n) => n.status === "running" ? { ...n, status: "idle" } : n));
  };

  const handleSaveWorkflow = async () => {
    await saveWorkflow(settings.project, workflowId, JSON.stringify({ nodes, edges }, null, 2));
  };

  const handleLoadWorkflow = async (id: string) => {
    try {
      const data = await loadWorkflow(settings.project, id.replace(".json", ""));
      const parsed = JSON.parse(data);
      if (parsed.nodes) setNodes(parsed.nodes);
      if (parsed.edges) setEdges(parsed.edges);
      setWorkflowId(id.replace(".json", ""));
      setShowWorkflowsPanel(false);
    } catch { /* ignore */ }
  };

  const refreshSavedWorkflows = useCallback(async () => {
    try { setSavedWorkflows(await listWorkflows(settings.project)); } catch { setSavedWorkflows([]); }
  }, [settings.project]);

  useEffect(() => { refreshSavedWorkflows(); }, [refreshSavedWorkflows]);

  const handleDeleteWorkflow = async (name: string) => {
    try {
      const path = `projects/${settings.project}/workflows/${name}`;
      const { deleteFile } = await import("@/lib/ipc");
      await deleteFile(path);
      await refreshSavedWorkflows();
    } catch { /* ignore */ }
    setDeleteConfirm(null);
  };

  const handleNewWorkflow = () => {
    pushUndo();
    setNodes([{ id: "n1", type: "input", x: 60, y: 140, label: "Input", status: "idle", data: {} }]);
    setEdges([]);
    setWorkflowId(`workflow-${Date.now()}`);
  };

  const handleAddCustomDef = () => {
    if (!customName.trim()) return;
    const def: NodeTypeDef = { type: `custom_${Date.now()}`, label: customName.trim(), desc: customDesc.trim() || "Custom node", category: "Custom", color: "#94a3b8" };
    setCustomDefs((prev) => [...prev, def]);
    setCustomName(""); setCustomDesc(""); setShowCustomForm(false);
  };

  const allNodeTypes = [...NODE_TYPES, ...customDefs];
  const categories = CATEGORY_ORDER.filter((c) => allNodeTypes.some((t) => t.category === c));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="h-full flex flex-col" onClick={() => setCtxMenu(null)}>
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
        <Button variant={running ? "destructive" : "default"} size="sm" className="gap-1 h-7 text-xs" onClick={running ? stopWorkflow : runWorkflow}>
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? "Stop" : "Run"}
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleUndo} title="Undo (Ctrl+Z)"><Undo2 size={12} /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={12} /></Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}><ZoomIn size={12} /></Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(z - 0.25, 0.25))}><ZoomOut size={12} /></Button>
        <span className="text-xs text-muted-foreground w-8">{Math.round(zoom * 100)}%</span>
        {connecting && <span className="text-xs text-primary ml-2 animate-pulse">Drop on input port to connect</span>}
        <div className="flex-1" />
        <span className="text-xs text-muted-foreground hidden sm:block truncate max-w-[120px]">{workflowId}</span>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="New workflow" onClick={handleNewWorkflow}><FilePlus size={12} /></Button>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSaveWorkflow}><Save size={12} />Save</Button>
        <Button variant={showWorkflowsPanel ? "secondary" : "outline"} size="sm" className="h-7 text-xs gap-1" onClick={() => setShowWorkflowsPanel((v) => !v)}><FolderOpen size={12} />Workflows</Button>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <Allotment>
          {/* Palette */}
          <Allotment.Pane preferredSize={200} minSize={160}>
            <div className="h-full border-r border-border bg-card overflow-auto">
              <div className="p-2 border-b border-border">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">Node Palette</div>
                <div className="text-[10px] text-muted-foreground px-1">Click to add to canvas</div>
              </div>
              <div className="p-2 space-y-3">
                {categories.map((cat) => (
                  <div key={cat}>
                    <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">{cat}</div>
                    <div className="space-y-0.5">
                      {allNodeTypes.filter((t) => t.category === cat).map((t) => (
                        <button
                          key={t.type}
                          onClick={() => addNode(t.type, t)}
                          className="w-full flex items-start gap-2 px-2 py-1.5 text-left rounded hover:bg-muted transition-colors group"
                        >
                          <span className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ background: t.color }} />
                          <div className="min-w-0">
                            <div className="text-xs font-medium leading-tight">{t.label}</div>
                            <div className="text-[10px] text-muted-foreground leading-tight">{t.desc}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}

                {/* Custom node creation */}
                <div>
                  <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1 mb-1">Custom</div>
                  {!showCustomForm ? (
                    <button
                      onClick={() => setShowCustomForm(true)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded border border-dashed border-border hover:border-primary hover:text-primary transition-colors"
                    >
                      <Plus size={10} />
                      Add custom node
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

          {/* Canvas */}
          <Allotment.Pane>
            <div
              className="h-full relative overflow-hidden bg-muted/10 select-none"
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onWheel={handleCanvasWheel}
              style={{ cursor: connecting ? "crosshair" : panning ? "grabbing" : "grab" }}
            >
              <div
                className="absolute origin-top-left canvas-bg"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: 3000, height: 3000 }}
              >
                {/* Grid */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-[0.07]">
                  <defs>
                    <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
                      <circle cx="1" cy="1" r="1" fill="currentColor" />
                    </pattern>
                  </defs>
                  <rect width="100%" height="100%" fill="url(#dots)" />
                </svg>

                {/* Edges */}
                <svg className="absolute inset-0 w-full h-full" style={{ overflow: "visible" }}>
                  {edges.map((edge) => {
                    const from = nodes.find((n) => n.id === edge.from);
                    const to   = nodes.find((n) => n.id === edge.to);
                    if (!from || !to) return null;
                    const p1 = outPort(from);
                    const p2 = inPort(to);
                    const dx = Math.max(Math.abs(p2.x - p1.x) * 0.5, 60);
                    const d = `M ${p1.x} ${p1.y} C ${p1.x+dx} ${p1.y}, ${p2.x-dx} ${p2.y}, ${p2.x} ${p2.y}`;
                    return (
                      <g key={`${edge.from}-${edge.to}`}>
                        {/* Invisible wide hit area */}
                        <path d={d} fill="none" stroke="transparent" strokeWidth="10" className="cursor-pointer" onClick={(e) => handleEdgeClick(e, edge.from, edge.to)} />
                        <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border pointer-events-none" />
                        {/* Arrow */}
                        <circle cx={p2.x} cy={p2.y} r="3" fill="currentColor" className="text-border pointer-events-none" />
                      </g>
                    );
                  })}

                  {/* Temporary connecting line */}
                  {connecting && (() => {
                    const from = nodes.find((n) => n.id === connecting.fromNodeId);
                    if (!from) return null;
                    const p1 = outPort(from);
                    const dx = Math.max(Math.abs(connecting.x - p1.x) * 0.5, 40);
                    return (
                      <path
                        d={`M ${p1.x} ${p1.y} C ${p1.x+dx} ${p1.y}, ${connecting.x-dx} ${connecting.y}, ${connecting.x} ${connecting.y}`}
                        fill="none" stroke="hsl(var(--primary))" strokeWidth="1.5" strokeDasharray="6 3"
                        className="pointer-events-none"
                      />
                    );
                  })()}
                </svg>

                {/* Nodes */}
                {nodes.map((node) => {
                  const def = allNodeTypes.find((t) => t.type === node.type) || { color: "#94a3b8", label: node.type, desc: "" };
                  const isSelected = selectedNodeId === node.id;
                  const isConnectingFrom = connecting?.fromNodeId === node.id;
                  const borderColor =
                    node.status === "done"    ? "#22c55e" :
                    node.status === "error"   ? "#ef4444" :
                    node.status === "running" ? "#3b82f6" :
                    isSelected               ? "hsl(var(--primary))" :
                    "hsl(var(--border))";

                  return (
                    <div
                      key={node.id}
                      className="absolute bg-card rounded-lg shadow-md"
                      style={{ left: node.x, top: node.y, width: NODE_W, height: NODE_H, border: `1.5px solid ${borderColor}`, boxSizing: "border-box" }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                      onContextMenu={(e) => handleNodeRightClick(e, node.id)}
                    >
                      {/* Color accent bar */}
                      <div className="absolute top-0 left-0 right-0 h-0.5 rounded-t-lg" style={{ background: def.color }} />

                      {/* Content */}
                      <div className="px-3 pt-2.5 pb-1 h-full flex flex-col justify-center">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: def.color }} />
                          <span className="text-[11px] font-semibold truncate leading-tight">{node.label}</span>
                          {node.status === "running" && <span className="ml-auto flex gap-0.5 shrink-0"><span className="thinking-dot w-1 h-1 rounded-full bg-blue-400 inline-block"/><span className="thinking-dot w-1 h-1 rounded-full bg-blue-400 inline-block"/><span className="thinking-dot w-1 h-1 rounded-full bg-blue-400 inline-block"/></span>}
                        </div>
                        <div className="text-[9px] text-muted-foreground truncate mt-0.5">{node.output || (def as NodeTypeDef).desc || node.type}</div>
                      </div>

                      {/* Input port (left) */}
                      <div
                        className="absolute w-3 h-3 rounded-full border-2 bg-card z-10 transition-colors hover:bg-primary hover:border-primary"
                        style={{ left: -6, top: NODE_H / 2 - 6, borderColor: isConnectingFrom ? "hsl(var(--primary))" : borderColor, cursor: "crosshair" }}
                        onMouseUp={(e) => handleInputPortMouseUp(e, node.id)}
                      />

                      {/* Output port (right) */}
                      <div
                        className="absolute w-3 h-3 rounded-full border-2 bg-card z-10 transition-colors hover:bg-primary hover:border-primary"
                        style={{ right: -6, top: NODE_H / 2 - 6, borderColor: isConnectingFrom ? "hsl(var(--primary))" : borderColor, cursor: "crosshair" }}
                        onMouseDown={(e) => handleOutputPortMouseDown(e, node.id)}
                      />
                    </div>
                  );
                })}
              </div>

              {/* Canvas hints */}
              {nodes.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="text-center text-muted-foreground">
                    <div className="text-sm font-medium mb-1">Canvas is empty</div>
                    <div className="text-xs">Click a node in the palette to add it</div>
                  </div>
                </div>
              )}
            </div>
          </Allotment.Pane>

          {/* Properties panel */}
          <Allotment.Pane preferredSize={260} minSize={200}>
            {selectedNode ? (
              <div className="h-full border-l border-border bg-card p-3 space-y-3 overflow-auto">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Settings size={14} />
                    <span className="text-sm font-medium">Properties</span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deleteNode(selectedNode.id)}>
                    <Trash2 size={12} className="text-red-500" />
                  </Button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">Label</label>
                  <Input value={selectedNode.label} onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })} className="h-7 text-xs" />
                </div>

                {(selectedNode.type === "input" || selectedNode.type === "custom") && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">{selectedNode.type === "custom" ? "System Prompt" : "Prompt"}</label>
                    <Textarea value={selectedNode.data?.prompt || ""} onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })} className="text-xs min-h-[80px] resize-none" placeholder="Enter prompt..." />
                  </div>
                )}

                {selectedNode.type === "bash" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Command</label>
                    <Input value={selectedNode.data?.command || ""} onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })} className="h-7 text-xs" placeholder="echo hello" />
                  </div>
                )}

                {selectedNode.type === "fetch" && (
                  <>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">URL</label><Input value={selectedNode.data?.url || ""} onChange={(e) => updateNodeData(selectedNode.id, { url: e.target.value })} className="h-7 text-xs" placeholder="https://api.example.com" /></div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Method</label><Input value={selectedNode.data?.method || "GET"} onChange={(e) => updateNodeData(selectedNode.id, { method: e.target.value })} className="h-7 text-xs" /></div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Headers (JSON)</label><Textarea value={selectedNode.data?.headers || "{}"} onChange={(e) => updateNodeData(selectedNode.id, { headers: e.target.value })} className="text-xs min-h-[60px] resize-none font-mono" /></div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Body</label><Textarea value={selectedNode.data?.body || ""} onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })} className="text-xs min-h-[60px] resize-none" /></div>
                  </>
                )}

                {selectedNode.type === "fileop" && (
                  <>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Operation</label><Input value={selectedNode.data?.operation || "read"} onChange={(e) => updateNodeData(selectedNode.id, { operation: e.target.value })} className="h-7 text-xs" placeholder="read or write" /></div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Path</label><Input value={selectedNode.data?.path || ""} onChange={(e) => updateNodeData(selectedNode.id, { path: e.target.value })} className="h-7 text-xs" placeholder="./file.txt" /></div>
                    {selectedNode.data?.operation === "write" && <div className="space-y-1"><label className="text-xs text-muted-foreground">Content</label><Textarea value={selectedNode.data?.content || ""} onChange={(e) => updateNodeData(selectedNode.id, { content: e.target.value })} className="text-xs min-h-[60px] resize-none" /></div>}
                  </>
                )}

                {selectedNode.type === "auth" && (
                  <>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Scheme</label><Input value={selectedNode.data?.authScheme || "bearer"} onChange={(e) => updateNodeData(selectedNode.id, { authScheme: e.target.value })} className="h-7 text-xs" placeholder="bearer / apikey / basic / oauth2" /></div>
                    <div className="space-y-1"><label className="text-xs text-muted-foreground">Token / Key</label><Input value={selectedNode.data?.authToken || ""} onChange={(e) => updateNodeData(selectedNode.id, { authToken: e.target.value })} className="h-7 text-xs" /></div>
                    {selectedNode.data?.authScheme === "apikey" && <div className="space-y-1"><label className="text-xs text-muted-foreground">Header Name</label><Input value={selectedNode.data?.authHeaderName || "X-API-Key"} onChange={(e) => updateNodeData(selectedNode.id, { authHeaderName: e.target.value })} className="h-7 text-xs" /></div>}
                  </>
                )}

                {selectedNode.type === "transform" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Transform Instruction</label><Textarea value={selectedNode.data?.prompt || ""} onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Convert to TypeScript, format JSON, etc." /></div>
                )}

                {selectedNode.type === "designSystem" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Theme Name</label><Input value={selectedNode.data?.prompt || ""} onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })} className="h-7 text-xs" placeholder="default, dark, light…" /></div>
                )}

                {selectedNode.type === "bun" && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Bun Command</label><Input value={selectedNode.data?.command || "dev"} onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })} className="h-7 text-xs" placeholder="dev, build, install" /></div>
                )}

                {(["requirements","architect","structure","style","interaction","reference","validate"].includes(selectedNode.type)) && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Context Override (optional)</label><Textarea value={selectedNode.data?.prompt || ""} onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Override input from previous node…" /></div>
                )}

                {selectedNode.type === "preview" && selectedNode.output && (
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Preview</label><div className="border border-border rounded overflow-hidden bg-white" style={{ height: 200 }}><iframe srcDoc={selectedNode.output} className="w-full h-full" sandbox="allow-scripts" title="Preview" /></div></div>
                )}

                <div className="pt-2 border-t border-border">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Status</div>
                  <div className="flex items-center gap-1.5">
                    <span className={["w-1.5 h-1.5 rounded-full", selectedNode.status === "done" ? "bg-green-500" : selectedNode.status === "error" ? "bg-red-500" : selectedNode.status === "running" ? "bg-blue-500 animate-pulse" : "bg-muted-foreground"].join(" ")} />
                    <span className="text-xs capitalize">{selectedNode.status || "idle"}</span>
                  </div>
                  {selectedNode.output && <div className="mt-2 text-[10px] text-muted-foreground bg-muted p-1.5 rounded break-all max-h-32 overflow-auto">{selectedNode.output}</div>}
                </div>

                <div className="pt-1 border-t border-border flex gap-1">
                  <Button variant="outline" size="sm" className="h-6 text-xs gap-1 flex-1" onClick={() => duplicateNode(selectedNode.id)}><Copy size={10} />Duplicate</Button>
                  <Button variant="outline" size="sm" className="h-6 text-xs gap-1 flex-1" onClick={() => disconnectNode(selectedNode.id)}>Disconnect</Button>
                </div>
              </div>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground text-xs gap-1 border-l border-border">
                <Settings size={20} className="opacity-30" />
                <span>Select a node to edit</span>
              </div>
            )}
          </Allotment.Pane>
        </Allotment>

        {/* Context menu */}
        {ctxMenu && (
          <div
            className="fixed z-50 bg-popover border border-border rounded-md shadow-lg py-1 min-w-[140px] text-xs"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => duplicateNode(ctxMenu.nodeId)}>
              <Copy size={11} /> Duplicate
            </button>
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted flex items-center gap-2" onClick={() => disconnectNode(ctxMenu.nodeId)}>
              <X size={11} /> Disconnect edges
            </button>
            <div className="my-1 h-px bg-border" />
            <button className="w-full text-left px-3 py-1.5 hover:bg-muted text-destructive flex items-center gap-2" onClick={() => deleteNode(ctxMenu.nodeId)}>
              <Trash2 size={11} /> Delete node
            </button>
          </div>
        )}

        {/* Workflows panel */}
        {showWorkflowsPanel && (
          <div className="absolute top-0 right-0 h-full w-[260px] bg-card border-l border-border z-40 flex flex-col shadow-xl">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
              <FolderOpen size={14} />
              <span className="text-sm font-medium flex-1">Saved Workflows</span>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => refreshSavedWorkflows()} title="Refresh"><RotateCw size={11} /></Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowWorkflowsPanel(false)}><X size={12} /></Button>
            </div>

            {/* New workflow */}
            <div className="p-2 border-b border-border">
              <div className="flex gap-1">
                <Input
                  value={workflowId}
                  onChange={(e) => setWorkflowId(e.target.value)}
                  placeholder="Workflow name…"
                  className="h-7 text-xs flex-1"
                  onKeyDown={(e) => { if (e.key === "Enter") handleSaveWorkflow(); }}
                />
                <Button size="sm" className="h-7 text-xs gap-1 shrink-0" onClick={handleSaveWorkflow}>
                  <Save size={11} />Save
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 px-0.5">Current: {nodes.length} nodes · {edges.length} edges</p>
            </div>

            <div className="flex-1 overflow-auto p-2 space-y-1">
              {savedWorkflows.length === 0 && (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-xs gap-2">
                  <FolderOpen size={20} className="opacity-30" />
                  No saved workflows yet
                </div>
              )}
              {savedWorkflows.map((wf) => {
                const name = wf.name.replace(".json", "");
                const isActive = workflowId === name;
                const isConfirming = deleteConfirm === wf.name;
                return (
                  <div
                    key={wf.path}
                    className={["rounded-md border transition-colors", isActive ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/40"].join(" ")}
                  >
                    <div className="flex items-center gap-2 px-2 py-1.5">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{name}</div>
                        {isActive && <div className="text-[10px] text-primary">currently loaded</div>}
                      </div>
                      {!isConfirming ? (
                        <div className="flex gap-0.5 shrink-0">
                          <Button
                            variant="ghost" size="sm" className="h-6 text-[10px] px-2"
                            onClick={() => handleLoadWorkflow(wf.name)}
                          >
                            Load
                          </Button>
                          <Button
                            variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                            onClick={() => setDeleteConfirm(wf.name)}
                          >
                            <Trash2 size={10} />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 shrink-0">
                          <Button variant="destructive" size="sm" className="h-6 text-[10px] px-2" onClick={() => handleDeleteWorkflow(wf.name)}>Delete</Button>
                          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-2 border-t border-border">
              <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1" onClick={handleNewWorkflow}>
                <FilePlus size={11} /> New blank workflow
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
