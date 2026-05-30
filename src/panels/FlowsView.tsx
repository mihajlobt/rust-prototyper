import { useCallback, useContext, useEffect, createContext, useMemo } from "react";
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
import { loadNavigation, saveNavigation, addNavLink, removeNavLink, syncGeneratedRouter, getDefaultPorts, type Navigation, type NavPort } from "@/lib/navigation";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";
import { CustomEdge } from "@/panels/flows/CustomEdge";

// ─── Actions context (avoids prop-drilling into React Flow node components) ─

interface FlowsActions {
  openScreen: (id: string) => void;
  setDefaultScreen: (id: string) => void;
  disconnectEdges: (nodeId: string) => void;
}

const FlowsActionsContext = createContext<FlowsActions | null>(null);

function useFlowsActions(): FlowsActions {
  const ctx = useContext(FlowsActionsContext);
  if (!ctx) throw new Error("useFlowsActions must be used inside FlowsActionsContext.Provider");
  return ctx;
}

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

  const renderHandles = (ports: NavPort[], type: "target" | "source") => {
    if (ports.length === 0) return null;
    const isInput = type === "target";
    const showLabels = ports.length > 1;
    return ports.map((port, index) => {
      const topPct = ports.length === 1
        ? 50
        : ((index + 1) / (ports.length + 1)) * 100;
      const isDefault = port.id.endsWith(":default-in") || port.id.endsWith(":default-out");
      return (
        <div
          key={port.id}
          className="absolute"
          style={{ top: `${topPct}%`, [isInput ? "left" : "right"]: 0, transform: "translateY(-50%)" }}
        >
          <Handle
            type={type}
            id={port.id}
            position={isInput ? Position.Left : Position.Right}
            style={{
              position: "relative",
              top: "unset",
              left: "unset",
              right: "unset",
              transform: "none",
              width: ports.length === 1 ? 10 : 8,
              height: ports.length === 1 ? 10 : 8,
              borderColor: getPortColor(port),
              flexShrink: 0,
            }}
          />
          {showLabels && !isDefault && (
            <span
              className="absolute text-[7px] text-muted-foreground/70 whitespace-nowrap leading-none pointer-events-none"
              style={{
                top: "50%",
                transform: "translateY(-50%)",
                [isInput ? "left" : "right"]: 12,
                maxWidth: 52,
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {port.name}
            </span>
          )}
        </div>
      );
    });
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="bg-card rounded-lg shadow-md cursor-pointer select-none"
          style={{ width: 160, minHeight: Math.max(64, (Math.max(inputPorts.length, outputPorts.length)) * 16 + 32), border: `1.5px solid ${borderColor}` }}
        >
          {renderHandles(inputPorts, "target")}
          {renderHandles(outputPorts, "source")}

          <div className="px-3 pt-1.5 pb-2">
            <div
              className="mb-1.5 h-0.5 rounded-full"
              style={{ background: data.isDefault ? "var(--primary)" : "var(--muted-foreground)", opacity: 0.5 }}
            />
            <div className="flex items-center gap-1.5">
              <Layout size={11} className="shrink-0 text-muted-foreground" />
              <span className="text-[11px] font-semibold truncate leading-tight flex-1">{data.label}</span>
              {data.isDefault && <Star size={9} className="shrink-0 text-primary fill-primary" />}
            </div>
            <Separator className="my-1 opacity-30" />
            <div className="text-[9px] text-muted-foreground">
              {data.isDefault ? "Entry screen" : "Screen"}
            </div>
          </div>
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
      try { await syncGeneratedRouter(projectDir); } catch (e) { notify.error("Failed to sync router", getErrorMessage(e)); }
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
        const screen = nav.screens.find((s) => s.id === node.id);
        if (screen) {
          screen.x = Math.round(node.position.x);
          screen.y = Math.round(node.position.y);
          await saveNavigation(projectDir, nav);
        }
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
