import { create } from "zustand";
import type { HttpResponse } from "@/lib/ipc";
import type { DesignBriefTemplate } from "@/lib/prompts";

// Ephemeral UI state — not persisted, resets on app restart.
// Per-project panel state (device, zoom, active item, etc.) lives in projectSettingsStore.

export interface ApiHistoryEntry {
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
}

/** Generation-context selections for the Screens/Components prompt toolbars.
 * Session-only and keyed by project so they survive panel remounts but reset
 * naturally when switching projects or restarting the app. */
export interface PanelGenContext {
  apiIds: string[];
  componentIds: string[];
  brief: DesignBriefTemplate | null;
}

export const EMPTY_GEN_CONTEXT: PanelGenContext = { apiIds: [], componentIds: [], brief: null };

interface UIState {
  // APIs panel — session-only (response, history, form helpers)
  apisResponse: HttpResponse | null;
  apisHistory: ApiHistoryEntry[];
  apisEnvVars: Record<string, string>;
  apisNewEnvKey: string;
  apisNewEnvValue: string;
  apisCurlPaste: string;
  apisOpenapiPaste: string;

  // Runner panel — file tree refresh counter (incremented by filesystem watcher)
  fileTreeRefreshKey: number;

  // Workflows panel
  workflowsShowPanel: boolean;

  // Generation-context selections for the merged Create panel, keyed by projectId.
  // Session-only — survives panel remounts but resets on app restart or project switch.
  createGenContext: Record<string, PanelGenContext>;
  setCreateGenContext: (projectId: string, patch: Partial<PanelGenContext>) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  apisResponse: null,
  apisHistory: [],
  apisEnvVars: {},
  apisNewEnvKey: "",
  apisNewEnvValue: "",
  apisCurlPaste: "",
  apisOpenapiPaste: "",

  fileTreeRefreshKey: 0,

  workflowsShowPanel: false,

  createGenContext: {},
  setCreateGenContext: (projectId, patch) =>
    set((s) => ({
      createGenContext: {
        ...s.createGenContext,
        [projectId]: { ...(s.createGenContext[projectId] ?? EMPTY_GEN_CONTEXT), ...patch },
      },
    })),
}));
