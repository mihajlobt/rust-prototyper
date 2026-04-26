import { create } from "zustand";
import type { HttpResponse } from "@/lib/ipc";

// Ephemeral UI state — not persisted, resets on app restart.
// Per-project panel state (device, zoom, active item, etc.) lives in projectSettingsStore.

export interface ApiHistoryEntry {
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
}

interface UIState {
  // APIs panel — session-only (response, history, form helpers)
  apisResponse: HttpResponse | null;
  apisHistory: ApiHistoryEntry[];
  apisEnvVars: Record<string, string>;
  apisNewEnvKey: string;
  apisNewEnvValue: string;
  apisCurlPaste: string;
  apisOpenapiPaste: string;

  // Runner panel
  runnerFileTreeNonce: number;

  // Workflows panel
  workflowsShowPanel: boolean;
}

export const useUIStore = create<UIState>()(() => ({
  apisResponse: null,
  apisHistory: [],
  apisEnvVars: {},
  apisNewEnvKey: "",
  apisNewEnvValue: "",
  apisCurlPaste: "",
  apisOpenapiPaste: "",

  runnerFileTreeNonce: 0,

  workflowsShowPanel: false,
}));
