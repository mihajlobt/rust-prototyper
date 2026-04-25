import { create, type StateCreator } from "zustand";

// ─── Project Slice ───

interface ProjectSlice {
  activeView: string;
  activeComponent: string | null;
  activeScreen: string | null;
  activeTheme: string | null;
  activeWorkflow: string | null;
  activeApi: string | null;

  setView: (view: string) => void;
  openComponent: (name: string) => void;
  openScreen: (name: string) => void;
  openTheme: (name: string) => void;
  openWorkflow: (name: string) => void;
  openApi: (id: string) => void;
}

const createProjectSlice: StateCreator<ProjectSlice> = (set) => ({
  activeView: "screens",
  activeComponent: null,
  activeScreen: null,
  activeTheme: null,
  activeWorkflow: null,
  activeApi: null,

  setView: (view) =>
    set({ activeView: view }),

  openComponent: (name) =>
    set({
      activeView: "components",
      activeComponent: name,
    }),

  openScreen: (name) =>
    set({
      activeView: "screens",
      activeScreen: name,
    }),

  openTheme: (name) =>
    set({
      activeView: "themes",
      activeTheme: name,
    }),

  openWorkflow: (name) =>
    set({
      activeView: "workflows",
      activeWorkflow: name,
    }),

  openApi: (id) =>
    set({
      activeView: "apis",
      activeApi: id,
    }),
});

export const useProjectStore = create<ProjectSlice>()((...args) => ({
  ...createProjectSlice(...args),
}));