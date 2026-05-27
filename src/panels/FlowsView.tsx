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
import { Layout, Star } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Separator } from "@/components/ui/separator";
import { loadNavigation, saveNavigation, addNavLink, removeNavLink, syncGeneratedRouter, type Navigation } from "@/lib/navigation";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";

// ─── Actions context (avoids prop-drilling into React Flow node components) ─

interface FlowsActions {
  openScreen: (id: string) => void;
  setDefaultScreen: (id: string) => void;
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

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className="bg-card rounded-lg shadow-md cursor-pointer select-none"
          style={{ width: 160, minHeight: 64, border: `1.5px solid ${borderColor}` }}
        >
          <Handle type="target" position={Position.Left} style={{ width: 10, height: 10, borderColor }} />
          <Handle type="source" position={Position.Right} style={{ width: 10, height: 10, borderColor }} />

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
      </ContextMenuContent>
    </ContextMenu>
  );
}

const nodeTypes = { screen: ScreenNodeComponent };

// ─── Layout helpers ────────────────────────────────────────────────────────

const COLS = 4;
const H_GAP = 220;
const V_GAP = 130;

function buildNodes(screenIds: string[], nav: Navigation, existingNodes: ScreenNode[]): ScreenNode[] {
  const positionById = new Map(existingNodes.map((n) => [n.id, n.position]));
  return screenIds.map((id, i) => ({
    id,
    type: "screen" as const,
    // Preserve user-dragged positions — only use grid for new nodes
    position: positionById.get(id) ?? { x: (i % COLS) * H_GAP, y: Math.floor(i / COLS) * V_GAP },
    data: {
      label: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      isDefault: id === nav.defaultScreen,
    },
  }));
}

function buildEdges(nav: Navigation): Edge[] {
  return nav.links.map((link) => ({
    id: link.id,
    source: link.from,
    target: link.to,
    type: "smoothstep",
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

  useEffect(() => {
    loadFlow();
  }, [loadFlow]);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      try {
        await addNavLink(projectDir, connection.source, connection.target);
        setEdges((eds) =>
          addEdge(
            {
              ...connection,
              id: `${connection.source}->${connection.target}`,
              type: "smoothstep",
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
    }),
    [projectDir, setPs, setNodes]
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
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
