import { create } from "zustand";
import {
  bonsaiStartServer,
  bonsaiStopServer,
  bonsaiServerStatus,
  bonsaiGenerateImage,
  bonsaiCancelGeneration,
  bonsaiListAssets,
  bonsaiDeleteAsset,
  bonsaiGetServerConfig,
  bonsaiSaveServerConfig,
  bonsaiScheduleStop,
  bonsaiCancelStop,
  type BonsaiServerConfig,
  type BonsaiServerStatus,
  type AssetInfo,
  type BonsaiGenerateResult,
} from "@/lib/bonsai";
import { getErrorMessage } from "@/lib/ipc";

interface BonsaiState {
  serverStatus: BonsaiServerStatus | null;
  config: BonsaiServerConfig | null;
  assets: AssetInfo[];
  generating: boolean;
  loading: boolean;
  error: string | null;
  lastResult: BonsaiGenerateResult | null;
  stopScheduled: boolean;
}

interface BonsaiActions {
  startServer: () => Promise<void>;
  stopServer: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  loadConfig: () => Promise<void>;
  saveConfig: (config: BonsaiServerConfig) => Promise<void>;
  generateImage: (params: {
    projectId: string;
    prompt: string;
    width?: number;
    height?: number;
    steps?: number;
    seed?: number;
    backend?: string;
  }) => Promise<BonsaiGenerateResult | null>;
  cancelGeneration: () => Promise<void>;
  listAssets: (projectId: string) => Promise<void>;
  deleteAsset: (projectId: string, fileName: string) => Promise<void>;
  scheduleStop: () => Promise<void>;
  cancelStop: () => Promise<void>;
  clearError: () => void;
  setStopScheduled: (v: boolean) => void;
}

export type BonsaiStore = BonsaiState & BonsaiActions;

export const BONSAI_DEFAULT_CONFIG: BonsaiServerConfig = {
  install_path: "",
  port: 8000,
  variant: "ternary",
  auto_stop_timeout_secs: 60,
};

export const useBonsaiStore = create<BonsaiStore>()((set, get) => ({
  serverStatus: null,
  config: null,
  assets: [],
  generating: false,
  loading: false,
  error: null,
  lastResult: null,
  stopScheduled: false,

  startServer: async () => {
    set({ loading: true, error: null });
    try {
      const info = await bonsaiStartServer();
      set({
        serverStatus: {
          healthy: info.healthy,
          kind: info.kind,
          supported_families: info.supported_families,
          default_family: info.default_family,
        },
        loading: false,
      });
    } catch (e) {
      set({ error: getErrorMessage(e), loading: false });
    }
  },

  stopServer: async () => {
    set({ loading: true, error: null, stopScheduled: false });
    try {
      await bonsaiStopServer();
      set({ serverStatus: null, loading: false });
    } catch (e) {
      set({ error: getErrorMessage(e), loading: false });
    }
  },

  refreshStatus: async () => {
    try {
      const status = await bonsaiServerStatus();
      set({ serverStatus: status });
    } catch {
      set({ serverStatus: null });
    }
  },

  loadConfig: async () => {
    try {
      const config = await bonsaiGetServerConfig();
      set({ config: config ?? BONSAI_DEFAULT_CONFIG });
    } catch {
      set({ config: BONSAI_DEFAULT_CONFIG });
    }
  },

  saveConfig: async (config: BonsaiServerConfig) => {
    set({ error: null });
    try {
      await bonsaiSaveServerConfig(config);
      set({ config });
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  generateImage: async (params) => {
    set({ generating: true, error: null, lastResult: null });
    try {
      const result = await bonsaiGenerateImage(params);
      set({ lastResult: result, generating: false });
      const { projectId } = params;
      if (projectId) {
        await get().listAssets(projectId);
      }
      return result;
    } catch (e) {
      set({ error: getErrorMessage(e), generating: false });
      return null;
    }
  },

  cancelGeneration: async () => {
    try {
      await bonsaiCancelGeneration();
      set({ generating: false });
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  listAssets: async (projectId: string) => {
    try {
      const assets = await bonsaiListAssets(projectId);
      set({ assets });
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  deleteAsset: async (projectId: string, fileName: string) => {
    try {
      await bonsaiDeleteAsset(projectId, fileName);
      await get().listAssets(projectId);
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  scheduleStop: async () => {
    try {
      await bonsaiScheduleStop();
      set({ stopScheduled: true });
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  cancelStop: async () => {
    try {
      await bonsaiCancelStop();
      set({ stopScheduled: false });
    } catch (e) {
      set({ error: getErrorMessage(e) });
    }
  },

  clearError: () => set({ error: null }),
  setStopScheduled: (v: boolean) => set({ stopScheduled: v }),
}));