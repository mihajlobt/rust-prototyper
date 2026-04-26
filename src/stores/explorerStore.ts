import { create } from "zustand";

interface ExplorerState {
  /** Incremented on any mutation — all tree consumers should refetch */
  treeVersion: number;

  /** Bump treeVersion to invalidate all tree queries */
  refresh: () => void;
}

export const useExplorerStore = create<ExplorerState>()((set) => ({
  treeVersion: 0,

  refresh: () => set((s) => ({ treeVersion: s.treeVersion + 1 })),
}));