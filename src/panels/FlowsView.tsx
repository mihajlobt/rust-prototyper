import { useCallback, useEffect } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { loadNavigation, saveNavigation, addNavLink, removeNavLink } from "@/lib/navigation";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";

interface FlowsViewProps {
  screenIds: string[];
  onSelectScreen: (id: string) => void;
}

const NODE_WIDTH = 160;
const NODE_HEIGHT = 60;
const COLS = 4;
const H_GAP = 200;
const V_GAP = 120;

function screenToNode(id: string, index: number, defaultScreenId: string): Node {
  const col = index % COLS;
  const row = Math.floor(index / COLS);
  return {
    id,
    position: { x: col * H_GAP, y: row * V_GAP },
    data: { label: id },
    style: {
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      borderRadius: 8,
      fontSize: 12,
      fontWeight: id === defaultScreenId ? 600 : 400,
      border: id === defaultScreenId ? "2px solid var(--primary)" : "1px solid var(--border)",
      background: "var(--card)",
      color: "var(--card-foreground)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
  };
}

function FlowsViewInner({ screenIds, onSelectScreen }: FlowsViewProps) {
  const { settings } = useAppStore();
  const { setPs } = useProjectSettingsStore();
  const projectDir = `projects/${settings.project}`;

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const nav = await loadNavigation(projectDir);
        if (cancelled) return;
        setNodes(screenIds.map((id, i) => screenToNode(id, i, nav.defaultScreen)));
        setEdges(
          (nav.links ?? []).map((link) => ({
            id: link.id,
            source: link.from,
            target: link.to,
            animated: true,
            style: { stroke: "var(--primary)" },
          }))
        );
      } catch (e) {
        if (!cancelled) notify.error("Failed to load navigation", getErrorMessage(e));
      }
    })();
    return () => { cancelled = true; };
  }, [screenIds, projectDir, setNodes, setEdges]);

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      try {
        await addNavLink(projectDir, connection.source, connection.target);
        setEdges((eds) => addEdge({
          ...connection,
          id: `${connection.source}->${connection.target}`,
          animated: true,
          style: { stroke: "var(--primary)" },
        }, eds));
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
    },
    [projectDir]
  );

  const onSetDefault = useCallback(
    async (screenId: string) => {
      try {
        const nav = await loadNavigation(projectDir);
        nav.defaultScreen = screenId;
        await saveNavigation(projectDir, nav);
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            style: {
              ...n.style,
              fontWeight: n.id === screenId ? 600 : 400,
              border: n.id === screenId ? "2px solid var(--primary)" : "1px solid var(--border)",
            },
          }))
        );
        notify.success("Default screen updated", `"${screenId}" is now the entry point`);
      } catch (e) {
        notify.error("Failed to update default screen", getErrorMessage(e));
      }
    },
    [projectDir, setNodes]
  );

  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setPs({ activeView: "screens", activeScreen: node.id });
      onSelectScreen(node.id);
    },
    [setPs, onSelectScreen]
  );

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: Node) => {
      event.preventDefault();
      onSetDefault(node.id);
    },
    [onSetDefault]
  );

  if (screenIds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
        <p className="text-sm">No screens yet</p>
        <p className="text-xs">Create a screen to see the flow map here</p>
      </div>
    );
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeContextMenu={onNodeContextMenu}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        deleteKeyCode="Delete"
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--border)" />
        <Controls showInteractive={false} />
      </ReactFlow>
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground pointer-events-none select-none">
        Double-click to open · Drag between nodes to link · Right-click to set as entry
      </div>
    </div>
  );
}

export function FlowsView(props: FlowsViewProps) {
  return (
    <ReactFlowProvider>
      <FlowsViewInner {...props} />
    </ReactFlowProvider>
  );
}
