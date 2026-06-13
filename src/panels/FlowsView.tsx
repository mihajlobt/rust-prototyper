import React, { useCallback, useEffect, useMemo } from "react";
import { FlowsActionsContext, useFlowsActions, type FlowsActions } from "@/panels/flows/FlowsContext";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Layout, Star, Unplug } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import {
  loadNavigation,
  saveNavigation,
  removeHotspot,
  syncGeneratedRouter,
  getHotspotLinks,
  hotspotLabel,
  type Navigation,
  type NavScreen,
  type Hotspot,
} from "@/lib/navigation";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";
import { CustomEdge } from "@/panels/flows/CustomEdge";

// ─── Screen node data ──────────────────────────────────────────────────────

interface ScreenNodeData {
  label: string;
  isDefault: boolean;
  outgoing: Array<{ id: string; label: string }>; // one per hotspot
  [key: string]: unknown;
}

type ScreenNode = Node<ScreenNodeData, "screen">;

// ─── Screen node component ─────────────────────────────────────────────────

function ScreenNodeComponent({ data, selected, id }: NodeProps<ScreenNode>) {
  const actions = useFlowsActions();

  const borderColor = data.isDefault
    ? "var(--primary)"
    : selected
    ? "var(--ring)"
    : "var(--border)";

  const showRows = data.outgoing.length > 0;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="bg-card rounded-lg shadow-md cursor-pointer select-none"
          style={{ width: 180, border: `1.5px solid ${borderColor}` }}
        >
          {/* Single target handle centered on left */}
          <Handle
            type="target"
            id={`${id}:in`}
            position={Position.Left}
            style={{ borderColor: "var(--primary)", background: "var(--card)" }}
          />
          {/* Fallback single source handle when no outgoing hotspots */}
          {!showRows && (
            <Handle
              type="source"
              id={`${id}:out`}
              position={Position.Right}
              style={{ borderColor: "var(--primary)", background: "var(--card)" }}
            />
          )}

          <div className="px-3 pt-1.5 pb-2">
            <div
              className="mb-1.5 h-0.5 rounded-full"
              style={{ background: data.isDefault ? "var(--primary)" : "var(--muted-foreground)", opacity: 0.5 }}
            />
            <div className="flex items-center gap-1 min-w-0">
              <Layout size={11} className="shrink-0 text-muted-foreground" />
              <span className="text-[11px] font-semibold truncate leading-tight flex-1 min-w-0">
                {data.label}
              </span>
              {data.isDefault && (
                <Star size={9} className="shrink-0 text-primary fill-primary ml-0.5" />
              )}
            </div>
            <Separator className="my-1 opacity-30" />
            <div className="text-[9px] text-muted-foreground">
              {data.isDefault ? "Entry screen" : "Screen"}
            </div>
          </div>

          {/* Per-hotspot source handles */}
          {showRows && (
            <div className="border-t border-border/30 pb-0.5">
              {data.outgoing.map((h) => (
                <div key={h.id} className="relative flex items-center h-5 px-2">
                  <div className="flex-1" />
                  <span className="text-[8px] text-foreground/50 truncate max-w-[120px] pr-1 text-right">
                    {h.label}
                  </span>
                  <Handle
                    type="source"
                    id={h.id}
                    position={Position.Right}
                    style={{ position: "absolute", right: -4, top: "50%", transform: "translateY(-50%)", width: 8, height: 8, borderColor: "var(--primary)", background: "var(--card)" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => actions.openScreen(id)}>
            Open in editor
          </ContextMenuItem>
          <ContextMenuItem onClick={() => actions.setDefaultScreen(id)}>
            <Star size={12} className="mr-1" />Set as entry screen
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem onClick={() => actions.disconnectEdges(id)}>
            <Unplug size={12} className="mr-1" />Disconnect edges
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

const nodeTypes = { screen: ScreenNodeComponent };
const edgeTypes = { flow: CustomEdge };

// ─── Layout helpers ────────────────────────────────────────────────────────

const COLS = 4;
const H_GAP = 220;
const V_GAP = 130;

function buildNodes(screenIds: string[], nav: Navigation, existingNodes: ScreenNode[]): ScreenNode[] {
  const positionById = new Map(existingNodes.map((n) => [n.id, n.position]));
  const navScreenById = new Map(nav.screens.map((s) => [s.id, s]));
  return screenIds.map((id, i) => {
    const navScreen = navScreenById.get(id);
    const saved = navScreen?.x != null && navScreen?.y != null ? { x: navScreen.x, y: navScreen.y } : undefined;
    const outgoing = nav.hotspots
      .filter((h: Hotspot) => h.screenId === id && h.targetScreenId)
      .map((h: Hotspot) => ({ id: h.id, label: hotspotLabel(h) }));
    return {
      id,
      type: "screen" as const,
      deletable: false,
      position: positionById.get(id) ?? saved ?? { x: (i % COLS) * H_GAP, y: Math.floor(i / COLS) * V_GAP },
      data: {
        label: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        isDefault: id === nav.defaultScreen,
        outgoing,
      },
    };
  });
}

function buildEdges(nav: Navigation): Edge[] {
  return getHotspotLinks(nav).map((link) => ({
    id: link.hotspotId,
    source: link.from,
    target: link.to,
    sourceHandle: link.hotspotId,
    targetHandle: `${link.to}:in`,
    type: "flow",
    animated: true,
    style: { stroke: "var(--primary)", strokeWidth: 1.5 },
  }));
}

// ─── Inner canvas (must be inside ReactFlowProvider) ──────────────────────

interface FlowsViewProps {
  screenIds: string[];
}

function FlowsViewInner({ screenIds }: FlowsViewProps) {
  const { settings } = useAppStore();
  const { setProjectSettings, openCreate } = useProjectSettingsStore();
  const projectDir = `projects/${settings.project}`;

  const [nodes, setNodes, onNodesChange] = useNodesState<ScreenNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const loadFlow = useCallback(async () => {
    try {
      const nav = await loadNavigation(projectDir);
      setNodes((current) => buildNodes(screenIds, nav, current));
      setEdges(buildEdges(nav));
    } catch (e) {
      notify.error("Failed to load navigation", getErrorMessage(e));
    }
  }, [projectDir, screenIds, setNodes, setEdges]);

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  useEffect(() => {
    const handler = () => loadFlow();
    window.addEventListener("navigation-changed", handler);
    return () => window.removeEventListener("navigation-changed", handler);
  }, [loadFlow]);

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      for (const edge of deleted) {
        try {
          await removeHotspot(projectDir, edge.id);
        } catch (e) {
          notify.error("Failed to remove link", getErrorMessage(e));
        }
      }
      try {
        await syncGeneratedRouter(projectDir);
        window.dispatchEvent(new Event("navigation-changed"));
      } catch (e) {
        notify.error("Failed to sync router", getErrorMessage(e));
      }
    },
    [projectDir]
  );

  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: ScreenNode) => {
      openCreate("screens", node.id);
    },
    [openCreate]
  );

  const onNodeDragStop = useCallback(
    async (_: unknown, node: ScreenNode) => {
      try {
        const nav = await loadNavigation(projectDir);
        let screen: NavScreen | undefined = nav.screens.find((s) => s.id === node.id);
        if (!screen) {
          screen = {
            id: node.id,
            path: `/${node.id}`,
            title: node.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          };
          nav.screens.push(screen);
          if (!nav.defaultScreen) nav.defaultScreen = node.id;
        }
        screen.x = Math.round(node.position.x);
        screen.y = Math.round(node.position.y);
        await saveNavigation(projectDir, nav);
      } catch { /* ignore persistence errors */ }
    },
    [projectDir]
  );

  const actions = useMemo<FlowsActions>(
    () => ({
      openScreen: (id) => openCreate("screens", id),
      setDefaultScreen: async (id) => {
        try {
          const nav = await loadNavigation(projectDir);
          nav.defaultScreen = id;
          await saveNavigation(projectDir, nav);
          await syncGeneratedRouter(projectDir);
          setNodes((nds) =>
            nds.map((n) => ({
              ...n,
              data: { ...n.data, isDefault: n.id === id },
            }))
          );
          notify.success("Entry screen updated", `"${id}" is now the starting screen`);
        } catch (e) {
          notify.error("Failed to update entry screen", getErrorMessage(e));
        }
      },
      disconnectEdges: async (id) => {
        try {
          const edgesToRemove = edges.filter((e) => e.source === id || e.target === id);
          for (const edge of edgesToRemove) {
            await removeHotspot(projectDir, edge.id);
          }
          setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
          await syncGeneratedRouter(projectDir);
          window.dispatchEvent(new Event("navigation-changed"));
        } catch (e) {
          notify.error("Failed to disconnect edges", getErrorMessage(e));
        }
      },
      deleteEdge: async (edgeId) => {
        try {
          await removeHotspot(projectDir, edgeId);
          setEdges((eds) => eds.filter((e) => e.id !== edgeId));
          await syncGeneratedRouter(projectDir);
          window.dispatchEvent(new Event("navigation-changed"));
        } catch (e) {
          notify.error("Failed to delete link", getErrorMessage(e));
        }
      },
    }),
    // setEdges is a stable setter from useEdgesState — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectDir, setProjectSettings, setNodes, edges]
  );

  if (screenIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-1 text-muted-foreground">
        <Layout size={24} className="opacity-30" />
        <p className="text-sm font-medium">No screens yet</p>
        <p className="text-xs opacity-60">Create a screen to map your app flow</p>
      </div>
    );
  }

  return (
    <FlowsActionsContext.Provider value={actions}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        deleteKeyCode="Delete"
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </FlowsActionsContext.Provider>
  );
}

// ─── Public export (wraps provider) ───────────────────────────────────────

export function FlowsView(props: FlowsViewProps) {
  return (
    <ReactFlowProvider>
      <FlowsViewInner {...props} />
    </ReactFlowProvider>
  );
}
