import { useContext } from "react";
import { type EdgeProps, BaseEdge, EdgeLabelRenderer, getSmoothStepPath } from "@xyflow/react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlowsActionsContext } from "@/panels/FlowsView";

export function CustomEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps) {
  const actions = useContext(FlowsActionsContext);

  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      <BaseEdge id={id} path={edgePath} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
          }}
          className="nodrag nopan"
        >
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 rounded-full opacity-0 hover:opacity-100 transition-opacity edge-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              actions?.deleteEdge(id);
            }}
          >
            <X size={10} />
          </Button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}
