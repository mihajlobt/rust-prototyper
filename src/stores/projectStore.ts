import { create, type StateCreator } from "zustand";

// ─── Project Slice ───

interface ProjectSlice {
  activeView: string;
  activeComponent: string | null;
  activeScreen: string | null;
  activeTheme: string | null;
  activeWorkflow: string | null;

  setView: (view: string) => void;
  openComponent: (name: string) => void;
  openScreen: (name: string) => void;
  openTheme: (name: string) => void;
  openWorkflow: (name: string) => void;
}

const createProjectSlice: StateCreator<ProjectSlice> = (set) => ({
  activeView: "screens",
  activeComponent: null,
  activeScreen: null,
  activeTheme: null,
  activeWorkflow: null,

  setView: (view) =>
    set({
      activeView: view,
      activeComponent: null,
      activeScreen: null,
      activeTheme: null,
      activeWorkflow: null,
    }),

  openComponent: (name) =>
    set({
      activeView: "components",
      activeComponent: name,
      activeScreen: null,
      activeTheme: null,
      activeWorkflow: null,
    }),

  openScreen: (name) =>
    set({
      activeView: "screens",
      activeScreen: name,
      activeComponent: null,
      activeTheme: null,
      activeWorkflow: null,
    }),

  openTheme: (name) =>
    set({
      activeView: "themes",
      activeTheme: name,
      activeComponent: null,
      activeScreen: null,
      activeWorkflow: null,
    }),

  openWorkflow: (name) =>
    set({
      activeView: "workflows",
      activeWorkflow: name,
      activeComponent: null,
      activeScreen: null,
      activeTheme: null,
    }),
});

export const useProjectStore = create<ProjectSlice>()((...args) => ({
  ...createProjectSlice(...args),
}));
