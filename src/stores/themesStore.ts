import { create } from "zustand";
import { readDir, isNotFoundError, getErrorMessage, type FileEntry } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { notify } from "@/hooks/useToast";

export interface ThemesQuery {
  data: FileEntry[];
  isLoading: boolean;
  dataUpdatedAt: number;
}

const EMPTY_QUERY: ThemesQuery = { data: [], isLoading: false, dataUpdatedAt: 0 };

interface ThemesState {
  byProject: Record<string, ThemesQuery>;
  loadThemes: (projectId: string) => Promise<void>;
}

export const useThemesStore = create<ThemesState>((set) => ({
  byProject: {},
  loadThemes: async (projectId) => {
    if (!projectId) return;
    set((s) => ({
      byProject: {
        ...s.byProject,
        [projectId]: { data: s.byProject[projectId]?.data ?? [], isLoading: true, dataUpdatedAt: s.byProject[projectId]?.dataUpdatedAt ?? 0 },
      },
    }));
    try {
      const entries = await readDir(`projects/${projectId}/themes`);
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: { data: entries.filter((e) => e.is_dir), isLoading: false, dataUpdatedAt: Date.now() },
        },
      }));
    } catch (e) {
      set((s) => ({
        byProject: {
          ...s.byProject,
          [projectId]: { data: [], isLoading: false, dataUpdatedAt: Date.now() },
        },
      }));
      if (!isNotFoundError(e)) notify.error("Failed to load themes", getErrorMessage(e));
    }
  },
}));

export function useThemesQuery(projectId: string): ThemesQuery {
  return useThemesStore((s) => s.byProject[projectId] ?? EMPTY_QUERY);
}

if (typeof window !== "undefined") {
  window.addEventListener("prototyper:tree-changed", (event) => {
    const detail = (event as CustomEvent<{ section?: string }>).detail;
    if (detail && detail.section !== "themes") return;
    const project = useAppStore.getState().settings.project;
    useThemesStore.getState().loadThemes(project);
  });
}