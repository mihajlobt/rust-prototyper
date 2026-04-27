import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { WORKFLOW_TEMPLATES, type WorkflowTemplate } from "@/workflows/templates";
import { NodePropertiesPanel } from "@/workflows/NodePropertiesPanel";
import {
  BUILTIN_NODE_TYPES,
  CATEGORY_ORDER,
  nodeTypes,
  generateId,
  type NodeTypeDef,
  type WorkflowNodeData,
  type WorkflowNodeType,
} from "@/workflows/nodeTypes";
import { useWorkflowExecution } from "@/workflows/useWorkflowExecution";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Edge,
  type Connection,
  BackgroundVariant,
  Panel,
  useReactFlow,
  ReactFlowProvider,
  NodeToolbar,
  Position,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Allotment } from "allotment";
import {
  Play, Square, Save, Trash2, Undo2, Redo2,
  Plus, X, Copy, FolderOpen, FilePlus, RotateCw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  saveWorkflow, loadWorkflow, listWorkflows,
  type FileEntry,
} from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";

// ─── Main view (needs ReactFlowProvider) ──────────────────────────────────

function WorkflowCanvas() {
  const { settings } = useAppStore();
  const { ps: { activeWorkflow: initialWorkflow }, setPs } = useProjectSettingsStore();
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("workflows", 2);
  const { screenToFlowPosition, getNodes, getEdges } = useReactFlow<WorkflowNodeType, Edge>();

  const flowContainerRef = useRef<HTMLDivElement>(null);
  const [flowReady, setFlowReady] = useState(false);
  useEffect(() => {
    const el = flowContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0 && entry.contentRect.height > 0) setFlowReady(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Refs for auto-save on unmount (avoids stale closures in cleanup)
  const latestStateRef = useRef<{ nodes: WorkflowNodeType[]; edges: Edge[]; workflowId: string }>({ nodes: [], edges: [], workflowId: "" });
  const projectRef = useRef(settings.project);
  useEffect(() => { projectRef.current = settings.project; }, [settings.project]);

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

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

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

  // ── Execution engine (delegated to extracted hook) ───────────────────────
  const { running, runSummary, runWorkflow, stopWorkflow } = useWorkflowExecution({
    settings: {
      project: settings.project,
      modelId: settings.modelId,
      provider: settings.provider,
      host: settings.host,
      apiKeys: settings.apiKeys,
      prompts: settings.prompts,
    },
    getNodes,
    getEdges,
    setNodes,
  });

  // ── Save / load ─────────────────────────────────────────────────────────
  const [workflowId, setWorkflowId] = useState("default");
  const [savedWorkflows, setSavedWorkflows] = useState<FileEntry[]>([]);
  const [showWorkflowsPanel, setShowWorkflowsPanel] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep latest state in a ref so the unmount cleanup can read it without stale closures
  useEffect(() => { latestStateRef.current = { nodes, edges, workflowId }; }, [nodes, edges, workflowId]);

  // Auto-save current workflow when navigating away
  useEffect(() => {
    return () => {
      const { nodes: ns, edges: es, workflowId: wid } = latestStateRef.current;
      const project = projectRef.current;
      if (project && wid && ns.length > 0) {
        saveWorkflow(project, wid, JSON.stringify({ nodes: ns, edges: es }, null, 2)).catch(() => {});
      }
    };
  }, []);

  const refreshSavedWorkflows = useCallback(async () => {
    try { setSavedWorkflows(await listWorkflows(settings.project)); } catch { setSavedWorkflows([]); }
  }, [settings.project]);

  useEffect(() => { refreshSavedWorkflows(); }, [refreshSavedWorkflows]);

  const handleLoad = useCallback(async (id: string, silent = false) => {
    setSaveError(null);
    const cleanId = id.replace(".json", "");
    try {
      const data = await loadWorkflow(settings.project, cleanId);
      const parsed = JSON.parse(data);
      if (parsed.nodes) setNodes(parsed.nodes);
      if (parsed.edges) setEdges(parsed.edges);
      setWorkflowId(cleanId);
      setShowWorkflowsPanel(false);
      setPs({ activeWorkflow: cleanId });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!silent) {
        setSaveError(msg);
        notify.error("Failed to load workflow", msg);
      }
    }
  }, [settings.project, setNodes, setEdges, setPs]);

  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (!initialWorkflow || !settings.project || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    handleLoad(initialWorkflow, true);
  }, [initialWorkflow, settings.project, handleLoad]);

  const handleSave = async () => {
    setSaveError(null);
    try {
      const id = workflowId.trim() || "default";
      setWorkflowId(id);
      await saveWorkflow(settings.project, id, JSON.stringify({ nodes: getNodes(), edges: getEdges() }, null, 2));
      setPs({ activeWorkflow: id });
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
    setPs({ activeWorkflow: null });
  };

  const handleLoadTemplate = (template: WorkflowTemplate) => {
    pushUndo();
    setNodes(template.nodes);
    setEdges(template.edges);
    setWorkflowId(template.id);
    setShowWorkflowsPanel(false);
    setPs({ activeWorkflow: null });
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
            <div ref={flowContainerRef} className="w-full h-full">
            {flowReady && <ReactFlow
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
              <NodeToolbar
                nodeId={selectedNodeId ?? ""}
                isVisible={!!selectedNodeId && !!selectedData}
                position={Position.Right}
                offset={12}
              >
                {selectedData && selectedNodeId && (
                  <NodePropertiesPanel
                    nodeId={selectedNodeId}
                    data={selectedData}
                    onUpdate={updateNodeData}
                    onDuplicate={duplicateSelected}
                    onDelete={deleteSelected}
                    onClose={() => setSelectedNodeId(null)}
                  />
                )}
              </NodeToolbar>
            </ReactFlow>}
            </div>
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
            <div className="p-2 border-t border-border space-y-1.5">
              <Button variant="outline" size="sm" className="w-full h-7 text-xs gap-1" onClick={handleNew}><FilePlus size={11} />New blank workflow</Button>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5 pt-1">Templates</p>
              {WORKFLOW_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="w-full text-left px-2 py-1.5 text-xs rounded border border-border hover:border-primary hover:bg-primary/5 transition-colors"
                  onClick={() => handleLoadTemplate(t)}
                >
                  <span className="font-medium">{t.label}</span>
                  <span className="block text-[10px] text-muted-foreground leading-tight mt-0.5">{t.description}</span>
                </button>
              ))}
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
