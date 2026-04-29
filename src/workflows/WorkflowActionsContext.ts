import { createContext, useContext } from "react";
import type { Edge } from "@xyflow/react";
import type { NodeTypeDef, WorkflowNodeType } from "@/workflows/nodeTypes";

interface WorkflowActions {
  pushUndo: () => void;
  setNodes: React.Dispatch<React.SetStateAction<WorkflowNodeType[]>>;
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  deleteNode: (id: string) => void;
  duplicateNode: (id: string) => void;
  disconnectEdges: (nodeId: string) => void;
  makeNode: (typeDef: NodeTypeDef, position?: { x: number; y: number }) => WorkflowNodeType;
}

export const WorkflowActionsContext = createContext<WorkflowActions | null>(null);

export function useWorkflowActions() {
  const ctx = useContext(WorkflowActionsContext);
  if (!ctx) throw new Error("useWorkflowActions must be used within WorkflowActionsContext.Provider");
  return ctx;
}