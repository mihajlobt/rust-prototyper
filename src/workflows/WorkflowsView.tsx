import { useState, useRef, useCallback } from "react";
import { Allotment } from "allotment";
import { Play, Square, ZoomIn, ZoomOut, Save, Trash2, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateCompletion, getApiKey, httpRequest, runShellCommand, readFile, writeFile, saveWorkflow, loadWorkflow, listWorkflows, bunDev, parseAiResponse, type FileEntry } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

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

const NODE_TYPES = [
  { type: "input", label: "Input", color: "#3b82f6" },
  { type: "requirements", label: "Requirements", color: "#8b5cf6" },
  { type: "architect", label: "Architect", color: "#10b981" },
  { type: "structure", label: "Structure", color: "#f59e0b" },
  { type: "style", label: "Style", color: "#ec4899" },
  { type: "interaction", label: "Interaction", color: "#6366f1" },
  { type: "parallel", label: "Parallel", color: "#f97316" },
  { type: "composition", label: "Composition", color: "#14b8a6" },
  { type: "bash", label: "Bash", color: "#64748b" },
  { type: "fetch", label: "Fetch", color: "#06b6d4" },
  { type: "fileop", label: "File Op", color: "#d946ef" },
  { type: "auth", label: "Auth", color: "#ef4444" },
  { type: "transform", label: "Transform", color: "#a855f7" },
  { type: "validate", label: "Validate", color: "#22c55e" },
  { type: "preview", label: "Preview", color: "#84cc16" },
  { type: "designSystem", label: "Design System", color: "#f472b6" },
  { type: "bun", label: "Bun", color: "#fbbf24" },
];

function generateNodeId() {
  return `n${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export function WorkflowsView() {
  const [nodes, setNodes] = useState<Node[]>([
    { id: "n1", type: "input", x: 50, y: 50, label: "User Prompt", status: "idle", data: { prompt: "Build a login form" } },
    { id: "n2", type: "requirements", x: 220, y: 50, label: "Parse Requirements", status: "idle" },
    { id: "n3", type: "architect", x: 390, y: 50, label: "Plan Structure", status: "idle" },
  ]);
  const [edges, setEdges] = useState<Edge[]>([
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3" },
  ]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const { settings } = useSettings();
  const [running, setRunning] = useState(false);
  const abortRef = useRef(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [edgeFrom, setEdgeFrom] = useState<string | null>(null);
  const [workflowId, setWorkflowId] = useState("default");
  const [savedWorkflows, setSavedWorkflows] = useState<FileEntry[]>([]);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef({ x: 0, y: 0 });

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null;

  const updateNode = useCallback((id: string, patch: Partial<Node>) => {
    setNodes((prev) => prev.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }, []);

  const updateNodeData = useCallback((id: string, dataPatch: Partial<NodeData>) => {
    setNodes((prev) =>
      prev.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...dataPatch } } : n
      )
    );
  }, []);

  const handleMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    if (e.shiftKey) {
      if (edgeFrom === null) {
        setEdgeFrom(nodeId);
      } else if (edgeFrom !== nodeId) {
        setEdges((prev) => {
          const exists = prev.some((ed) => ed.from === edgeFrom && ed.to === nodeId);
          if (exists) return prev;
          return [...prev, { from: edgeFrom, to: nodeId }];
        });
        setEdgeFrom(null);
      }
      return;
    }
    setSelectedNodeId(nodeId);
    setDragging(nodeId);
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current || (e.target as HTMLElement).closest(".canvas-inner")) {
      setPanning(true);
      panStart.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
      setSelectedNodeId(null);
      setEdgeFrom(null);
    }
  };

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;
      if (panning) {
        setPan({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
        return;
      }
      if (!dragging) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan.x) / zoom;
      const y = (e.clientY - rect.top - pan.y) / zoom;
      setNodes((prev) => prev.map((n) => (n.id === dragging ? { ...n, x, y } : n)));
    },
    [dragging, panning, zoom, pan]
  );

  const handleMouseUp = () => {
    setDragging(null);
    setPanning(false);
  };

  const addNode = (type: string) => {
    const def = NODE_TYPES.find((t) => t.type === type)!;
    setNodes((prev) => [
      ...prev,
      {
        id: generateNodeId(),
        type,
        x: 100 + prev.length * 40,
        y: 100 + prev.length * 40,
        label: def.label,
        status: "idle",
        data: {},
      },
    ]);
  };

  const deleteNode = (id: string) => {
    setNodes((prev) => prev.filter((n) => n.id !== id));
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const getPrevOutput = (nodeId: string): string => {
    const incoming = edges.filter((e) => e.to === nodeId);
    if (incoming.length === 0) return "";
    const prevNode = nodes.find((n) => n.id === incoming[0].from);
    return prevNode?.output || "";
  };

  const runWorkflow = async () => {
    setRunning(true);
    abortRef.current = false;
    // Reset statuses
    setNodes((prev) => prev.map((n) => ({ ...n, status: "idle" as const, output: undefined })));

    // Topological order using Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of edges) {
      adj.get(e.from)!.push(e.to);
      inDegree.set(e.to, inDegree.get(e.to)! + 1);
    }
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adj.get(id)!) {
        inDegree.set(next, inDegree.get(next)! - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    // Fallback: if cycle, execute in node array order
    const executionOrder = order.length === nodes.length ? order : nodes.map((n) => n.id);

    for (const nodeId of executionOrder) {
      if (abortRef.current) break;
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) continue;

      updateNode(nodeId, { status: "running", output: undefined });
      const prevOutput = getPrevOutput(nodeId);

      try {
        let output = "";
        const promptBase = node.data?.prompt || node.label;
        const model = settings.modelId;
        const host = settings.host;
        const apiKey = getApiKey(model, settings.apiKeys);

        switch (node.type) {
          case "input": {
            output = promptBase;
            break;
          }
          case "requirements": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Extract and structure requirements from the user request. Output as bullet points." },
              { role: "user", content: prevOutput || promptBase },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "architect": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Create a high-level architecture plan. List components, data flow, and state management." },
              { role: "user", content: prevOutput || promptBase },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "structure": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Generate HTML/JSX structure. Output only code, no explanations." },
              { role: "user", content: prevOutput || promptBase },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "style": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Apply Tailwind CSS classes to the provided HTML/JSX. Output only the styled code." },
              { role: "user", content: prevOutput || promptBase },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "interaction": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Add React hooks and state management to the component. Output only code." },
              { role: "user", content: prevOutput || promptBase },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "bash": {
            const cmd = node.data?.command || "echo 'No command'";
            await runShellCommand(".", cmd);
            output = `Executed: ${cmd}`;
            break;
          }
          case "fetch": {
            const url = node.data?.url || "https://api.github.com";
            const method = node.data?.method || "GET";
            let headers: Record<string, string> = {};
            try {
              headers = JSON.parse(node.data?.headers || "{}");
            } catch {
              // ignore
            }
            // Apply auth from previous auth node
            const prevAuth = nodes.find((n) => edges.some((e) => e.to === nodeId && e.from === n.id && n.type === "auth"));
            if (prevAuth?.output) {
              try {
                const authHeaders = JSON.parse(prevAuth.output);
                Object.assign(headers, authHeaders);
              } catch {
                // ignore
              }
            }
            const res = await httpRequest(method, url, headers, node.data?.body || undefined);
            output = `Status: ${res.status}\n${res.body.slice(0, 2000)}`;
            break;
          }
          case "fileop": {
            const op = node.data?.operation || "read";
            const path = node.data?.path || "./test.txt";
            if (op === "read") {
              const content = await readFile(path);
              output = content.slice(0, 2000);
            } else if (op === "write") {
              await writeFile(path, node.data?.content || "");
              output = `Wrote to ${path}`;
            } else {
              output = `Unknown operation: ${op}`;
            }
            break;
          }
          case "parallel": {
            const branches = edges.filter((e) => e.from === nodeId);
            const childIds = branches.map((e) => e.to);
            const results = await Promise.all(childIds.map(async (cid) => {
              const child = nodes.find((n) => n.id === cid);
              if (!child) return "";
              updateNode(cid, { status: "running" });
              try {
                let childOutput = "";
                if (child.type === "bash" && child.data?.command) {
                  await runShellCommand(".", child.data.command);
                  childOutput = `Executed: ${child.data.command}`;
                } else if (child.type === "fetch" && child.data?.url) {
                  let h: Record<string, string> = {};
                  try { h = JSON.parse(child.data.headers || "{}"); } catch {}
                  const res = await httpRequest(child.data.method || "GET", child.data.url, h, child.data.body || undefined);
                  childOutput = `Status: ${res.status}`;
                } else if (["requirements", "architect", "structure", "style", "interaction", "transform", "validate"].includes(child.type)) {
                  const p = child.data?.prompt || child.label;
                  const r = await generateCompletion(settings.modelId, [
                    { role: "system", content: `Execute ${child.type} node` },
                    { role: "user", content: p },
                  ], false, settings.host, getApiKey(settings.modelId, settings.apiKeys));
                  childOutput = parseAiResponse(r);
                } else {
                  childOutput = child.label;
                }
                updateNode(cid, { status: "done", output: childOutput.slice(0, 500) });
                return childOutput;
              } catch (e) {
                updateNode(cid, { status: "error", output: String(e).slice(0, 500) });
                return String(e);
              }
            }));
            output = `Parallel: ${branches.length} branches\n${results.join("\n").slice(0, 500)}`;
            break;
          }
          case "composition": {
            const incoming = edges.filter((e) => e.to === nodeId);
            const merged = incoming.map((e) => {
              const n = nodes.find((n) => n.id === e.from);
              return n?.output || "";
            }).join("\n\n---\n\n");
            output = merged || "No inputs to compose";
            break;
          }
          case "auth": {
            const scheme = node.data?.prompt || "bearer";
            const token = node.data?.command || "token";
            let headers: Record<string, string> = {};
            if (scheme === "bearer") {
              headers["Authorization"] = `Bearer ${token}`;
            } else if (scheme === "apikey") {
              headers["X-API-Key"] = token;
            } else if (scheme === "basic") {
              headers["Authorization"] = `Basic ${btoa(token)}`;
            } else if (scheme === "oauth2") {
              headers["Authorization"] = `Bearer ${token}`;
            }
            output = JSON.stringify(headers);
            break;
          }
          case "transform": {
            const transformPrompt = node.data?.prompt || "Clean up and format the input";
            const res = await generateCompletion(model, [
              { role: "system", content: "Transform the provided content according to the instruction. Output only the transformed content." },
              { role: "user", content: `Instruction: ${transformPrompt}\n\nContent: ${prevOutput}` },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "validate": {
            const res = await generateCompletion(model, [
              { role: "system", content: "Validate the provided code. List any syntax errors, type errors, or issues. If valid, say 'Valid'." },
              { role: "user", content: prevOutput || "No code to validate" },
            ], false, host, apiKey);
            output = parseAiResponse(res);
            break;
          }
          case "preview": {
            output = prevOutput || "Nothing to preview";
            break;
          }
          case "designSystem": {
            const themeName = node.data?.prompt || "default";
            output = `Applied design system: ${themeName}\n${prevOutput || ""}`;
            break;
          }
          case "bun": {
            const cmd = node.data?.command || "dev";
            if (cmd === "dev") {
              await bunDev(".", 5173);
              output = "Started bun dev on port 5173";
            } else if (cmd === "build") {
              await runShellCommand(".", "bun build");
              output = "Ran bun build";
            } else if (cmd === "install") {
              await runShellCommand(".", "bun install");
              output = "Ran bun install";
            } else {
              output = `Unknown bun command: ${cmd}`;
            }
            break;
          }
          default: {
            output = prevOutput || `Node ${node.label} passed through`;
          }
        }

        updateNode(nodeId, { status: "done", output: output.slice(0, 500) });
      } catch (e) {
        updateNode(nodeId, { status: "error", output: String(e).slice(0, 500) });
      }
    }

    setRunning(false);
  };

  const stopWorkflow = () => {
    abortRef.current = true;
    setRunning(false);
    setNodes((prev) => prev.map((n) => (n.status === "running" ? { ...n, status: "idle" } : n)));
  };

  const handleSaveWorkflow = async () => {
    const data = JSON.stringify({ nodes, edges }, null, 2);
    await saveWorkflow(settings.project, workflowId, data);
  };

  const handleLoadWorkflow = async (id: string) => {
    try {
      const data = await loadWorkflow(settings.project, id.replace(".json", ""));
      const parsed = JSON.parse(data);
      if (parsed.nodes) setNodes(parsed.nodes);
      if (parsed.edges) setEdges(parsed.edges);
      setWorkflowId(id.replace(".json", ""));
      setShowLoadDialog(false);
    } catch {
      // ignore
    }
  };

  const refreshSavedWorkflows = async () => {
    try {
      const entries = await listWorkflows(settings.project);
      setSavedWorkflows(entries);
    } catch {
      setSavedWorkflows([]);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
        <Button
          variant={running ? "destructive" : "default"}
          size="sm"
          className="gap-1 h-7 text-xs"
          onClick={running ? stopWorkflow : runWorkflow}
        >
          {running ? <Square size={12} /> : <Play size={12} />}
          {running ? "Stop" : "Run"}
        </Button>
        <div className="w-px h-4 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}>
          <ZoomIn size={12} />
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}>
          <ZoomOut size={12} />
        </Button>
        <span className="text-xs text-muted-foreground">{Math.round(zoom * 100)}%</span>
        {edgeFrom && (
          <span className="text-xs text-blue-500 ml-2">Click target node to connect</span>
        )}
        <div className="flex-1" />
        <Input
          value={workflowId}
          onChange={(e) => setWorkflowId(e.target.value)}
          placeholder="Workflow name"
          className="h-7 text-xs w-[140px]"
        />
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSaveWorkflow}>
          <Save size={12} />
          Save
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            refreshSavedWorkflows();
            setShowLoadDialog(true);
          }}
        >
          Load
        </Button>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <Allotment>
          <Allotment.Pane preferredSize={200} minSize={160}>
            {/* Palette */}
            <div className="h-full border-r border-border bg-card p-2 space-y-1 overflow-auto">
              <div className="text-xs font-medium text-muted-foreground mb-2 px-1">Nodes</div>
              {NODE_TYPES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => addNode(t.type)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: t.color }} />
                  {t.label}
                </button>
              ))}
            </div>
          </Allotment.Pane>

          <Allotment.Pane>
            {/* Canvas */}
            <div className="h-full relative overflow-hidden bg-muted/20" ref={canvasRef}>
              <div
                className="absolute inset-0 origin-top-left cursor-grab active:cursor-grabbing"
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div className="canvas-inner absolute inset-0 w-[3000px] h-[3000px]">
                  {/* Grid */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-10">
                    <defs>
                      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
                        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
                      </pattern>
                    </defs>
                    <rect width="100%" height="100%" fill="url(#grid)" />
                  </svg>

                  {/* Edges */}
                  <svg className="absolute inset-0 w-full h-full pointer-events-none">
                    {edges.map((edge) => {
                      const fromNode = nodes.find((n) => n.id === edge.from);
                      const toNode = nodes.find((n) => n.id === edge.to);
                      if (!fromNode || !toNode) return null;
                      return (
                        <line
                          key={`${edge.from}-${edge.to}`}
                          x1={fromNode.x + 60}
                          y1={fromNode.y + 20}
                          x2={toNode.x + 60}
                          y2={toNode.y + 20}
                          stroke="currentColor"
                          strokeWidth="1"
                          className="text-border"
                        />
                      );
                    })}
                  </svg>

                  {/* Nodes */}
                  {nodes.map((node) => {
                    const def = NODE_TYPES.find((t) => t.type === node.type);
                    const isSelected = selectedNodeId === node.id;
                    const isEdgeSource = edgeFrom === node.id;
                    const statusColor =
                      node.status === "done"
                        ? "border-green-500"
                        : node.status === "error"
                        ? "border-red-500"
                        : node.status === "running"
                        ? "border-blue-500 animate-pulse"
                        : isSelected || isEdgeSource
                        ? "border-primary"
                        : "border-border";
                    return (
                      <div
                        key={node.id}
                        className={[
                          "absolute w-[120px] bg-card rounded-md border shadow-sm p-2 cursor-pointer select-none",
                          statusColor,
                        ].join(" ")}
                        style={{ left: node.x, top: node.y }}
                        onMouseDown={(e) => handleMouseDown(e, node.id)}
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: def?.color || "#999" }}
                          />
                          <span className="text-[10px] font-medium truncate">{node.label}</span>
                        </div>
                        {node.output && (
                          <div className="text-[9px] text-muted-foreground truncate">{node.output}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </Allotment.Pane>

          <Allotment.Pane preferredSize={260} minSize={200}>
            {/* Properties */}
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
                  <Input
                    value={selectedNode.label}
                    onChange={(e) => updateNode(selectedNode.id, { label: e.target.value })}
                    className="h-7 text-xs"
                  />
                </div>

                {selectedNode.type === "input" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Prompt</label>
                    <Textarea
                      value={selectedNode.data?.prompt || ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      className="text-xs min-h-[80px] resize-none"
                      placeholder="Enter prompt..."
                    />
                  </div>
                )}

                {selectedNode.type === "bash" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Command</label>
                    <Input
                      value={selectedNode.data?.command || ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="e.g. echo hello"
                    />
                  </div>
                )}

                {selectedNode.type === "fetch" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">URL</label>
                      <Input
                        value={selectedNode.data?.url || ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { url: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="https://api.example.com"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Method</label>
                      <Input
                        value={selectedNode.data?.method || "GET"}
                        onChange={(e) => updateNodeData(selectedNode.id, { method: e.target.value })}
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Headers (JSON)</label>
                      <Textarea
                        value={selectedNode.data?.headers || "{}"}
                        onChange={(e) => updateNodeData(selectedNode.id, { headers: e.target.value })}
                        className="text-xs min-h-[60px] resize-none font-mono"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Body</label>
                      <Textarea
                        value={selectedNode.data?.body || ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { body: e.target.value })}
                        className="text-xs min-h-[60px] resize-none"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === "fileop" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Operation</label>
                      <Input
                        value={selectedNode.data?.operation || "read"}
                        onChange={(e) => updateNodeData(selectedNode.id, { operation: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="read or write"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Path</label>
                      <Input
                        value={selectedNode.data?.path || ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { path: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="./file.txt"
                      />
                    </div>
                    {selectedNode.data?.operation === "write" && (
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Content</label>
                        <Textarea
                          value={selectedNode.data?.content || ""}
                          onChange={(e) => updateNodeData(selectedNode.id, { content: e.target.value })}
                          className="text-xs min-h-[60px] resize-none"
                        />
                      </div>
                    )}
                  </>
                )}

                {selectedNode.type === "preview" && (
                  <div className="text-xs text-muted-foreground">Displays output from previous node</div>
                )}

                {selectedNode.type === "auth" && (
                  <>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Auth Scheme</label>
                      <Input
                        value={selectedNode.data?.prompt || "bearer"}
                        onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="bearer, apikey, basic, oauth2"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Token / Key</label>
                      <Input
                        value={selectedNode.data?.command || ""}
                        onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })}
                        className="h-7 text-xs"
                        placeholder="token or username:password"
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === "transform" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Transform Instruction</label>
                    <Textarea
                      value={selectedNode.data?.prompt || ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      className="text-xs min-h-[60px] resize-none"
                      placeholder="e.g. Convert to TypeScript, format JSON, etc."
                    />
                  </div>
                )}

                {selectedNode.type === "validate" && (
                  <div className="text-xs text-muted-foreground">Validates code for syntax and type errors</div>
                )}

                {selectedNode.type === "designSystem" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Theme Name</label>
                    <Input
                      value={selectedNode.data?.prompt || ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="default, dark, light, etc."
                    />
                  </div>
                )}

                {selectedNode.type === "bun" && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Bun Command</label>
                    <Input
                      value={selectedNode.data?.command || "dev"}
                      onChange={(e) => updateNodeData(selectedNode.id, { command: e.target.value })}
                      className="h-7 text-xs"
                      placeholder="dev, build, install"
                    />
                  </div>
                )}

                {(selectedNode.type === "requirements" ||
                  selectedNode.type === "architect" ||
                  selectedNode.type === "structure" ||
                  selectedNode.type === "style" ||
                  selectedNode.type === "interaction") && (
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Context Override (optional)</label>
                    <Textarea
                      value={selectedNode.data?.prompt || ""}
                      onChange={(e) => updateNodeData(selectedNode.id, { prompt: e.target.value })}
                      className="text-xs min-h-[60px] resize-none"
                      placeholder="Override the input passed from previous node..."
                    />
                  </div>
                )}

                <div className="pt-2 border-t border-border">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Status</div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={[
                        "w-1.5 h-1.5 rounded-full",
                        selectedNode.status === "done"
                          ? "bg-green-500"
                          : selectedNode.status === "error"
                          ? "bg-red-500"
                          : selectedNode.status === "running"
                          ? "bg-blue-500"
                          : "bg-muted-foreground",
                      ].join(" ")}
                    />
                    <span className="text-xs capitalize">{selectedNode.status || "idle"}</span>
                  </div>
                  {selectedNode.output && (
                    <div className="mt-2 text-[10px] text-muted-foreground bg-muted p-1.5 rounded break-all">
                      {selectedNode.output}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-muted-foreground text-xs">
                Select a node to edit properties
              </div>
            )}
          </Allotment.Pane>
        </Allotment>

        {/* Load Dialog Overlay */}
        {showLoadDialog && (
          <div className="absolute top-2 right-2 z-50 w-[240px] bg-card border border-border rounded-md shadow-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Load Workflow</span>
              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setShowLoadDialog(false)}>
                <Trash2 size={10} />
              </Button>
            </div>
            {savedWorkflows.length === 0 && (
              <div className="text-xs text-muted-foreground">No saved workflows</div>
            )}
            <div className="space-y-1 max-h-[200px] overflow-auto">
              {savedWorkflows.map((wf) => (
                <button
                  key={wf.path}
                  className="w-full text-left px-2 py-1 text-xs rounded hover:bg-muted transition-colors truncate"
                  onClick={() => handleLoadWorkflow(wf.name)}
                >
                  {wf.name.replace(".json", "")}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
