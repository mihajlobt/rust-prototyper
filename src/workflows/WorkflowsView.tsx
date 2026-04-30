import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  WORKFLOW_TEMPLATES,
  type WorkflowTemplate,
} from "@/workflows/templates";
import { NodePropertiesPanel } from "@/workflows/NodePropertiesPanel";
import { OutputChatPanel } from "@/workflows/OutputChatPanel";
import { BUILTIN_NODE_TYPES, CATEGORY_ORDER, nodeTypes, generateId, type NodeTypeDef, type WorkflowNodeData, type WorkflowNodeType } from "@/workflows/nodeTypes";
import { useWorkflowExecution } from "@/workflows/useWorkflowExecution";
import { WorkflowActionsContext } from "@/workflows/WorkflowActionsContext";
import { useWorkflowPersistence } from "@/workflows/useWorkflowPersistence";
import { ReactFlow, Background, Controls, ControlButton, MiniMap, addEdge, useNodesState, useEdgesState, type Edge, type Connection, BackgroundVariant, Panel, useReactFlow, ReactFlowProvider, NodeToolbar, Position, SelectionMode } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Allotment } from "allotment";
import { Play, Square, Pause, Save, Trash2, Undo2, Redo2, X, FolderOpen, FilePlus, RotateCw, Lasso as LassoIcon, MousePointer2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Lasso } from "@/workflows/Lasso";

function WorkflowCanvas() {
  const [outputPanelNodeId, setOutputPanelNodeId] = useState<string | null>(null);
  const outputPanelOpen = !!outputPanelNodeId;
  const [lassoMode, setLassoMode] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);

  const { ref: outputRef, onDragEnd: outputOnDragEnd, defaultSizes: outputDefault } = useAllotmentLayout("workflows-output", 2, [true, outputPanelOpen]);
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

  const categories = CATEGORY_ORDER.filter((c) => BUILTIN_NODE_TYPES.some((t) => t.category === c));

  const defaultColor = (type: string) => BUILTIN_NODE_TYPES.find((t) => t.type === type)?.color ?? "var(--node-custom)";

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

  const [nodes, setNodes, onNodesChange] = useNodesState<WorkflowNodeType>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const outputPanelNode = nodes.find((n) => n.id === outputPanelNodeId) ?? null;

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
    if (outputPanelNodeId === selectedNodeId) setOutputPanelNodeId(null);
    setSelectedNodeId(null);
  }, [selectedNodeId, outputPanelNodeId, pushUndo, setNodes, setEdges]);

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

  const disconnectEdges = useCallback((nodeId: string) => {
    pushUndo();
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
  }, [pushUndo, setEdges]);

  // Pane right-click context menu state (flow = node placement coords, screen = anchor position)
  const [paneContextMenuPos, setPaneContextMenuPos] = useState<{ flowX: number; flowY: number; screenX: number; screenY: number } | null>(null);
  const [menuKey, setMenuKey] = useState(0); // forces DropdownMenuContent remount so Popper re-measures trigger

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setPaneContextMenuPos(null);
  }, []);

  const onNodeClick = useCallback((_: React.MouseEvent, node: WorkflowNodeType) => {
    setSelectedNodeId(node.id);
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
    const typeDef = BUILTIN_NODE_TYPES.find((t) => t.type === nodeType);
    if (!typeDef) return;
    const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    pushUndo();
    setNodes((prev) => [...prev, makeNode(typeDef, position)]);
  }, [screenToFlowPosition, pushUndo, setNodes, makeNode]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); if (e.shiftKey) { handleRedo(); } else { handleUndo(); } }
      if (e.key === "Escape") setSelectedNodeId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleUndo, handleRedo]);

  // ── Save / load (delegated to extracted hook) ────────────────────────────
  const {
    workflowId, setWorkflowId,
    savedWorkflows, showWorkflowsPanel, setShowWorkflowsPanel,
    deleteConfirm, setDeleteConfirm, saveError,
    handleLoad, handleSave, handleDelete, refreshSavedWorkflows,
    settings, setPs,
  } = useWorkflowPersistence({ nodes, setNodes, edges, setEdges });

  // ── Execution engine (delegated to extracted hook) ───────────────────────
  const { running, paused, runSummary, runWorkflow, pauseWorkflow, resumeWorkflow, stopWorkflow } = useWorkflowExecution({
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

  // Pane context menu: capture both flow position (for node placement) and screen position (for anchor)
  const handlePaneContextMenu = useCallback((event: React.MouseEvent | MouseEvent) => {
    event.preventDefault(); // suppress browser native context menu
    const flowPos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setPaneContextMenuPos({ flowX: flowPos.x, flowY: flowPos.y, screenX: event.clientX, screenY: event.clientY });
    setMenuKey((k) => k + 1); // force DropdownMenuContent remount so Popper re-measures trigger at new position
  }, [screenToFlowPosition]);

  const addNodeAtPos = useCallback((typeDef: NodeTypeDef) => {
    pushUndo();
    const position = paneContextMenuPos ? { x: paneContextMenuPos.flowX, y: paneContextMenuPos.flowY } : { x: 200, y: 200 };
    setNodes((prev) => [...prev, makeNode(typeDef, position)]);
    setPaneContextMenuPos(null);
  }, [pushUndo, setNodes, makeNode, paneContextMenuPos]);

  // Node action helpers for WorkflowActionsContext (used by WorkflowNode context menu)
  const deleteNodeById = useCallback((nodeId: string) => {
    pushUndo();
    setNodes((prev) => prev.filter((n) => n.id !== nodeId));
    setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (outputPanelNodeId === nodeId) setOutputPanelNodeId(null);
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }, [pushUndo, setNodes, setEdges, outputPanelNodeId, selectedNodeId]);

  const duplicateNodeById = useCallback((nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    pushUndo();
    const newNode: WorkflowNodeType = {
      ...node,
      id: generateId(),
      position: { x: node.position.x + 40, y: node.position.y + 40 },
      data: { ...node.data, status: "idle", output: undefined },
      selected: false,
    };
    setNodes((prev) => [...prev, newNode]);
  }, [nodes, pushUndo, setNodes]);

  const workflowActions = useMemo(() => ({
    pushUndo, setNodes, setEdges,
    deleteNode: deleteNodeById,
    duplicateNode: duplicateNodeById,
    disconnectEdges,
    makeNode,
  }), [pushUndo, setNodes, setEdges, deleteNodeById, duplicateNodeById, disconnectEdges, makeNode]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <WorkflowActionsContext.Provider value={workflowActions}>
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
        {!running && !paused && (
          <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={runWorkflow}>
            <Play size={12} />Run
          </Button>
        )}
        {running && !paused && (
          <>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={pauseWorkflow}>
              <Pause size={12} />Pause
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs gap-1" onClick={stopWorkflow}>
              <Square size={12} />Stop
            </Button>
          </>
        )}
        {paused && (
          <>
            <Button variant="default" size="sm" className="h-7 text-xs gap-1" onClick={resumeWorkflow}>
              <Play size={12} />Resume
            </Button>
            <Button variant="destructive" size="sm" className="h-7 text-xs gap-1" onClick={stopWorkflow}>
              <Square size={12} />Stop
            </Button>
          </>
        )}
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
        <Allotment ref={outputRef} onDragEnd={outputOnDragEnd} defaultSizes={outputDefault} onVisibleChange={(_index, visible) => { if (!visible) setOutputPanelNodeId(null); }}>
              <Allotment.Pane>
                <DropdownMenu open={!!paneContextMenuPos} modal={false} onOpenChange={(open) => { if (!open) setPaneContextMenuPos(null); }}>
                  <DropdownMenuTrigger asChild>
                    {/* Invisible anchor positioned at right-click location for Radix Popper */}
                    <div
                      style={{
                        position: "fixed",
                        left: paneContextMenuPos ? `${paneContextMenuPos.screenX}px` : 0,
                        top: paneContextMenuPos ? `${paneContextMenuPos.screenY}px` : 0,
                        width: 0,
                        height: 0,
                        pointerEvents: "none",
                      }}
                    />
                  </DropdownMenuTrigger>
                  <div ref={flowContainerRef} className="w-full h-full">
                    {flowReady && <ReactFlow
                      nodes={nodes}
                      edges={edges}
                      onNodesChange={onNodesChange}
                      onEdgesChange={onEdgesChange}
                      onConnect={onConnect}
                      onNodeClick={onNodeClick}
                      onPaneContextMenu={handlePaneContextMenu}
                      onPaneClick={onPaneClick}
                      onDrop={onDrop}
                      onDragOver={onDragOver}
                      nodeTypes={nodeTypes}
                      fitView
                      snapToGrid
                      snapGrid={[16, 16]}
                      defaultEdgeOptions={{ type: "smoothstep", animated: false }}
                      deleteKeyCode={["Backspace", "Delete"]}
                      onEdgesDelete={() => pushUndo()}
                      proOptions={{ hideAttribution: true }}
                      className="bg-muted/10"
                      panOnDrag={lassoMode || selectionMode ? [1, 2] : true}
                      selectionOnDrag={selectionMode}
                      selectionMode={SelectionMode.Full}
                    >
                      <Background variant={BackgroundVariant.Dots} gap={24} size={1} className="opacity-30" />
                      
                      <Controls>
                        <ControlButton
                          onClick={() => {
                            setLassoMode((v) => !v);
                            setSelectionMode(false);
                          }}
                          title="Lasso selection"
                        >
                          <LassoIcon size={14} className={lassoMode ? "text-primary" : undefined} />
                        </ControlButton>
                        <ControlButton
                          onClick={() => {
                            setSelectionMode((v) => !v);
                            setLassoMode(false);
                          }}
                          title="Selection mode"
                        >
                          <MousePointer2 size={14} className={selectionMode ? "text-primary" : undefined} />
                        </ControlButton>
                      </Controls>
                      {lassoMode && <Lasso partial />}
                      <MiniMap<WorkflowNodeType>
                        nodeColor={(n) => n.data.color || "var(--node-custom)"}
                        className="!bg-card !border-border rounded-lg overflow-hidden"
                        maskColor="rgba(0,0,0,0.2)"
                      />
                      {nodes.length === 0 && (
                        <Panel position="top-center">
                          <div className="text-muted-foreground text-xs mt-8">Right-click to add nodes</div>
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
                            onViewOutput={() => setOutputPanelNodeId(selectedNodeId)}
                          />
                        )}
                      </NodeToolbar>
                    </ReactFlow>}
                  </div>
                  <DropdownMenuContent key={menuKey} className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
                    {categories.map((cat) => (
                      <DropdownMenuSub key={cat}>
                        <DropdownMenuSubTrigger>{cat}</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuGroup>
                            {BUILTIN_NODE_TYPES.filter((t) => t.category === cat).map((t, i, arr) => [
                              <DropdownMenuItem key={t.type} onSelect={() => addNodeAtPos(t)}>
                                <div className="min-w-0 flex flex-col gap-0.5">
                                  <span className="font-medium inline-flex items-center gap-1.5">
                                    <t.icon style={{ color: t.color }} />{t.label}
                                  </span>
                                  <span className="text-muted-foreground">{t.desc}</span>
                                  <span className="text-muted-foreground/70">{t.tooltip}</span>
                                </div>
                              </DropdownMenuItem>,
                              i < arr.length - 1 && <DropdownMenuSeparator key={`${t.type}-sep`} className="mx-2" />
                            ])}
                          </DropdownMenuGroup>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </Allotment.Pane>

              {/* Output chat panel */}
              <Allotment.Pane visible={outputPanelOpen} preferredSize={480} minSize={320} snap>
                {outputPanelOpen && outputPanelNode && (
                  <OutputChatPanel
                    label={outputPanelNode.data.label}
                    color={outputPanelNode.data.color}
                    status={outputPanelNode.data.status}
                    output={outputPanelNode.data.output}
                    onClose={() => setOutputPanelNodeId(null)}
                  />
                )}
              </Allotment.Pane>
            </Allotment>

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
            </ScrollArea>
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
    </WorkflowActionsContext.Provider>
  );
}

export function WorkflowsView() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  );
}
