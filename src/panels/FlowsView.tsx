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
  addEdge,
  Handle,
  Position,
  type Node,
  type Edge,
  type Connection,
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
import { loadNavigation, saveNavigation, addNavLink, removeNavLink, syncGeneratedRouter, getDefaultPorts, type Navigation, type NavPort, type NavScreen } from "@/lib/navigation";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";
import { CustomEdge } from "@/panels/flows/CustomEdge";

// ─── Screen node data ──────────────────────────────────────────────────────

interface ScreenNodeData {
  label: string;
  isDefault: boolean;
  ports: NavPort[];
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

  const inputPorts = data.ports.filter((p) => p.direction === "input");
  const outputPorts = data.ports.filter((p) => p.direction === "output");

  const getPortColor = (port: NavPort) =>
    port.type === "data" ? "var(--status-done)" : "var(--primary)";

  const isDefaultPort = (port: NavPort) =>
    port.id.endsWith(":default-in") || port.id.endsWith(":default-out");

  // Show inline port rows when there are named ports or more than one port on either side.
  // Default single-in/single-out nodes use centered handles with no rows.
  const showPortRows =
    data.ports.some((p) => !isDefaultPort(p)) ||
    inputPorts.length > 1 ||
    outputPorts.length > 1;

  const maxRows = Math.max(inputPorts.length, outputPorts.length);

  // Handle style for port-row handles — absolute inside their relative row div,
  // straddling the card edge (centered on the boundary at ±4px = half of 8px dot).
  const edgeHandleStyle = (port: NavPort, side: "left" | "right"): React.CSSProperties => ({
    position: "absolute",
    [side]: -4,
    top: "50%",
    transform: "translateY(-50%)",
    width: 8,
    height: 8,
    borderColor: getPortColor(port),
    background: "var(--card)",
  });

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="bg-card rounded-lg shadow-md cursor-pointer select-none"
          style={{ width: 180, border: `1.5px solid ${borderColor}` }}
        >
          {/* Centered handles for default single-port nodes — no port row section */}
          {!showPortRows &&
            inputPorts.map((p) => (
              <Handle
                key={p.id}
                type="target"
                id={p.id}
                position={Position.Left}
                style={{ borderColor: getPortColor(p), background: "var(--card)" }}
              />
            ))}
          {!showPortRows &&
            outputPorts.map((p) => (
              <Handle
                key={p.id}
                type="source"
                id={p.id}
                position={Position.Right}
                style={{ borderColor: getPortColor(p), background: "var(--card)" }}
              />
            ))}

          {/* Header */}
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

          {/* Port rows — one row per max(inputs, outputs), handles at card edges */}
          {showPortRows && (
            <div className="border-t border-border/30 pb-0.5">
              {Array.from({ length: maxRows }, (_, i) => {
                const inPort = inputPorts[i];
                const outPort = outputPorts[i];
                return (
                  <div key={i} className="relative flex items-center h-5 px-2">
                    {inPort && (
                      <>
                        <Handle
                          type="target"
                          id={inPort.id}
                          position={Position.Left}
                          style={edgeHandleStyle(inPort, "left")}
                        />
                        {!isDefaultPort(inPort) && (
                          <span className="text-[8px] text-foreground/60 truncate max-w-[64px] pl-1">
                            {inPort.name}
                          </span>
                        )}
                      </>
                    )}
                    <div className="flex-1" />
                    {outPort && (
                      <>
                        {!isDefaultPort(outPort) && (
                          <span className="text-[8px] text-foreground/60 truncate max-w-[64px] pr-1 text-right">
                            {outPort.name}
                          </span>
                        )}
                        <Handle
                          type="source"
                          id={outPort.id}
                          position={Position.Right}
                          style={edgeHandleStyle(outPort, "right")}
                        />
                      </>
                    )}
                  </div>
                );
              })}
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
    const ports = navScreen?.ports ?? getDefaultPorts(id);
    // Priority: in-memory (drag in progress) > saved in navigation.json > grid default
    const saved = navScreen?.x != null && navScreen?.y != null ? { x: navScreen.x, y: navScreen.y } : undefined;
    return {
      id,
      type: "screen" as const,
      deletable: false,
      position: positionById.get(id) ?? saved ?? { x: (i % COLS) * H_GAP, y: Math.floor(i / COLS) * V_GAP },
      data: {
        label: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        isDefault: id === nav.defaultScreen,
        ports,
      },
    };
  });
}

function buildEdges(nav: Navigation): Edge[] {
  return nav.links.map((link) => ({
    id: link.id,
    source: link.from,
    target: link.to,
    sourceHandle: link.fromPort,
    targetHandle: link.toPort,
    type: "flow",
    animated: link.type === "navigation",
    style: { stroke: link.type === "data" ? "var(--status-done)" : "var(--primary)", strokeWidth: 1.5, strokeDasharray: link.type === "data" ? "5,5" : undefined },
    data: { linkType: link.type },
  }));
}

// ─── Inner canvas (must be inside ReactFlowProvider) ──────────────────────

interface FlowsViewProps {
  screenIds: string[];
}

function FlowsViewInner({ screenIds }: FlowsViewProps) {
  const { settings } = useAppStore();
  const { setPs } = useProjectSettingsStore();
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

  // Re-load when project changes
  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  // Listen for navigation-changed events (emitted by PortsEditor/ScreensPanel after saves)
  useEffect(() => {
    const handler = () => loadFlow();
    window.addEventListener("navigation-changed", handler);
    return () => window.removeEventListener("navigation-changed", handler);
  }, [loadFlow]);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const fromPort = connection.sourceHandle ?? `${connection.source}:default-out`;
      const toPort = connection.targetHandle ?? `${connection.target}:default-in`;
      try {
        await addNavLink(projectDir, connection.source, fromPort, connection.target, toPort, "navigation");
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              id: `${connection.source}:${fromPort}->${connection.target}:${toPort}`,
              type: "flow",
              animated: true,
              style: { stroke: "var(--primary)", strokeWidth: 1.5 },
            },
            eds
          )
        );
        await syncGeneratedRouter(projectDir);
      } catch (e) {
        notify.error("Failed to add navigation link", getErrorMessage(e));
      }
    },
    [projectDir, setEdges]
  );

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      for (const edge of deleted) {
        try {
          await removeNavLink(projectDir, edge.id);
        } catch (e) {
          notify.error("Failed to remove navigation link", getErrorMessage(e));
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
      setPs({ activeView: "screens", activeScreen: node.id });
    },
    [setPs]
  );

  const onNodeDragStop = useCallback(
    async (_: React.MouseEvent, node: ScreenNode) => {
      try {
        const nav = await loadNavigation(projectDir);
        let screen: NavScreen | undefined = nav.screens.find((s) => s.id === node.id);
        if (!screen) {
          // Auto-register screen if absent (pre-navigation.json projects or first drag)
          screen = {
            id: node.id,
            path: `/${node.id}`,
            title: node.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
            ports: getDefaultPorts(node.id),
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
      openScreen: (id) => setPs({ activeView: "screens", activeScreen: id }),
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
            await removeNavLink(projectDir, edge.id);
          }
          setEdges((eds) => eds.filter((e) => e.source !== id && e.target !== id));
          await syncGeneratedRouter(projectDir);
        } catch (e) {
          notify.error("Failed to disconnect edges", getErrorMessage(e));
        }
      },
      deleteEdge: async (edgeId) => {
        try {
          await removeNavLink(projectDir, edgeId);
          setEdges((eds) => eds.filter((e) => e.id !== edgeId));
          await syncGeneratedRouter(projectDir);
        } catch (e) {
          notify.error("Failed to delete link", getErrorMessage(e));
        }
      },
    }),
    // setEdges is a stable setter from useEdgesState — safe to omit
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectDir, setPs, setNodes, edges]
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
        onConnect={onConnect}
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
