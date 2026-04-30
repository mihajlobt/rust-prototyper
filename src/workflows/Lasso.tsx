import { useRef, type PointerEvent } from "react";
import { useReactFlow, useStore } from "@xyflow/react";
import { getSvgPathFromStroke } from "@/workflows/lassoUtils";

type NodePoints = [number, number][];
type NodePointObject = Record<string, NodePoints>;

/**
 * Lasso selection overlay for React Flow.
 *
 * Renders a canvas on top of the flow that captures pointer events and
 * selects nodes whose corners fall inside the drawn polygon path.
 *
 * Reference: https://reactflow.dev/examples/whiteboard/lasso-selection
 */
export function Lasso({ partial }: { partial: boolean }) {
  const { flowToScreenPosition, setNodes } = useReactFlow();
  const { width, height, nodeLookup } = useStore((state) => ({
    width: state.width,
    height: state.height,
    nodeLookup: state.nodeLookup,
  }));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const nodePointsRef = useRef<NodePointObject>({});
  const pointRef = useRef<[number, number][]>([]);

  function getCanvasPoint(e: PointerEvent<HTMLCanvasElement>): [number, number] {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function handlePointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointRef.current = [getCanvasPoint(e)];

    nodePointsRef.current = {};
    for (const node of nodeLookup.values()) {
      const { x, y } = node.internals.positionAbsolute;
      const nodeWidth = node.measured.width ?? 0;
      const nodeHeight = node.measured.height ?? 0;
      nodePointsRef.current[node.id] = [
        [x, y],
        [x + nodeWidth, y],
        [x + nodeWidth, y + nodeHeight],
        [x, y + nodeHeight],
      ];
    }

    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.lineWidth = 1;
    ctx.fillStyle = "rgba(0, 89, 220, 0.08)";
    ctx.strokeStyle = "rgba(0, 89, 220, 0.8)";
  }

  function handlePointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (e.buttons !== 1) return;
    const [x, y] = getCanvasPoint(e);
    const nextPoints = [...pointRef.current, [x, y]] as [number, number][];
    pointRef.current = nextPoints;

    const path = new Path2D(getSvgPathFromStroke(nextPoints));
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    ctx.fill(path);
    ctx.stroke(path);

    const nodesToSelect = new Set<string>();

    for (const [nodeId, points] of Object.entries(nodePointsRef.current)) {
      if (partial) {
        for (const point of points) {
          const { x, y } = flowToScreenPosition({ x: point[0], y: point[1] });
          if (ctx.isPointInPath(path, x, y)) {
            nodesToSelect.add(nodeId);
            break;
          }
        }
      } else {
        let allPointsInPath = true;
        for (const point of points) {
          const { x, y } = flowToScreenPosition({ x: point[0], y: point[1] });
          if (!ctx.isPointInPath(path, x, y)) {
            allPointsInPath = false;
            break;
          }
        }
        if (allPointsInPath) {
          nodesToSelect.add(nodeId);
        }
      }
    }

    setNodes((nodes) =>
      nodes.map((node) => ({
        ...node,
        selected: nodesToSelect.has(node.id),
      })),
    );
  }

  function handlePointerUp(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.releasePointerCapture(e.pointerId);
    pointRef.current = [];
    if (ctxRef.current) {
      ctxRef.current.clearRect(0, 0, width, height);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="react-flow__lasso"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "auto",
      }}
    />
  );
}
