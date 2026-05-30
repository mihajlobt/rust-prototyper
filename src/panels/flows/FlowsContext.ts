import { createContext, useContext } from "react";

export interface FlowsActions {
  openScreen: (id: string) => void;
  setDefaultScreen: (id: string) => void;
  disconnectEdges: (nodeId: string) => void;
  deleteEdge: (edgeId: string) => void;
}

export const FlowsActionsContext = createContext<FlowsActions | null>(null);

export function useFlowsActions(): FlowsActions {
  const ctx = useContext(FlowsActionsContext);
  if (!ctx) throw new Error("useFlowsActions must be used inside FlowsActionsContext.Provider");
  return ctx;
}
