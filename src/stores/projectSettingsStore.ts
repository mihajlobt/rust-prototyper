import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProjectSettings {
  // Navigation — which item is open in each panel
  activeView: string;
  activeComponent: string | null;
  activeScreen: string | null;
  activeTheme: string | null;
  activeWorkflow: string | null;
  activeApi: string | null;

  // Project configuration
  stylePreset: string;
  directories: {
    themes: string;
    components: string;
    screens: string;
  };

  // Screens panel
  screensDevice: "desktop" | "tablet" | "mobile";
  screensZoom: number;
  screensShowInspector: boolean;
  screensDarkPreview: boolean;
  screensPreviewPort: number;

  // Components panel
  componentsDevice: "desktop" | "tablet" | "mobile";
  componentsDarkPreview: boolean;
  componentsShowInspector: boolean;
  componentsCodeOpen: boolean;

  // Themes panel
  themesDevice: "desktop" | "tablet" | "mobile";
  themesDarkPreview: boolean;
  themesShowInspector: boolean;
  themesCodeOpen: boolean;
  themesFramework: "shadcn" | "daisy" | "bootstrap" | "generic";
  themesDarkLightSupport: boolean;

  // Runner panel
  runnerDevice: "desktop" | "tablet" | "mobile";
  runnerZoom: number;
  runnerTerminalOpen: boolean;
  runnerActiveTab: "terminal" | "logs" | "network";
  runnerEditorTabs: string[];
  runnerEditorActiveTabPath: string | null;

  // APIs panel — persistent editor state
  apisName: string;
  apisMethod: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  apisUrl: string;
  apisHeadersText: string;
  apisBody: string;
  apisAuthType: "none" | "bearer" | "apikey" | "basic" | "oauth2";
  apisAuthToken: string;
  apisAuthHeaderName: string;
  apisAuthUsername: string;
  apisAuthPassword: string;
  apisAuthTokenUrl: string;
  apisAuthClientId: string;
  apisAuthClientSecret: string;
  apisShowInspector: boolean;

  // Component preview
  shadcnMode: boolean;
  devServerPort: number;
  runnerPort: number;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  activeView: "screens",
  activeComponent: null,
  activeScreen: null,
  activeTheme: null,
  activeWorkflow: null,
  activeApi: null,

  stylePreset: "",
  directories: {
    themes: "src/styles/themes",
    components: "src/components",
    screens: "src/screens",
  },

  screensDevice: "desktop",
  screensZoom: 1,
  screensShowInspector: false,
  screensDarkPreview: false,
  screensPreviewPort: 5175,

  componentsDevice: "desktop",
  componentsDarkPreview: false,
  componentsShowInspector: false,
  componentsCodeOpen: false,

  themesDevice: "desktop",
  themesDarkPreview: false,
  themesShowInspector: false,
  themesCodeOpen: false,
  themesFramework: "shadcn",
  themesDarkLightSupport: true,

  runnerDevice: "desktop",
  runnerZoom: 1,
  runnerTerminalOpen: true,
  runnerActiveTab: "terminal",
  runnerEditorTabs: [],
  runnerEditorActiveTabPath: null,

  apisName: "",
  apisMethod: "GET",
  apisUrl: "",
  apisHeadersText: "{}",
  apisBody: "",
  apisAuthType: "none",
  apisAuthToken: "",
  apisAuthHeaderName: "X-API-Key",
  apisAuthUsername: "",
  apisAuthPassword: "",
  apisAuthTokenUrl: "",
  apisAuthClientId: "",
  apisAuthClientSecret: "",
  apisShowInspector: false,

  shadcnMode: true,
  devServerPort: 5173,
  runnerPort: 5174,
};

// ─── Store handle cache — one open handle per project ─────────────────────────

const storeCache = new Map<string, Awaited<ReturnType<typeof load>>>();

async function getStore(projectId: string) {
  if (!storeCache.has(projectId)) {
    const store = await load(`project-${projectId}.json`, {
      defaults: DEFAULT_PROJECT_SETTINGS as unknown as Record<string, unknown>,
    });
    storeCache.set(projectId, store);
  }
  return storeCache.get(projectId)!;
}

// Debounce disk flushes per project — in-memory is updated immediately
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(projectId: string, store: Awaited<ReturnType<typeof load>>) {
  const existing = saveTimers.get(projectId);
  if (existing) clearTimeout(existing);
  saveTimers.set(projectId, setTimeout(() => {
    store.save().catch(console.error);
    saveTimers.delete(projectId);
  }, 400));
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ProjectSettingsStore {
  projectId: string;
  ps: ProjectSettings;
  loaded: boolean;

  /** Switch to a project — loads its persisted settings from disk. */
  loadProject: (projectId: string) => Promise<void>;

  /**
   * Patch project settings. Applies optimistically to Zustand immediately,
   * then persists to disk (debounced 400ms).
   */
  setPs: (patch: Partial<ProjectSettings>) => void;

  // Navigation helpers
  openComponent: (name: string) => void;
  openScreen: (name: string) => void;
  openTheme: (name: string) => void;
  openWorkflow: (name: string) => void;
  openApi: (id: string) => void;
}

export const useProjectSettingsStore = create<ProjectSettingsStore>()((set, get) => ({
  projectId: "",
  ps: DEFAULT_PROJECT_SETTINGS,
  loaded: false,

  loadProject: async (projectId: string) => {
    if (!projectId) return;
    const store = await getStore(projectId);
    const entries = await store.entries<unknown>();
    const loaded = { ...DEFAULT_PROJECT_SETTINGS };
    for (const [key, value] of entries) {
      if (key in loaded) {
        (loaded as unknown as Record<string, unknown>)[key] = value;
      }
    }
    set({ projectId, ps: loaded, loaded: true });
  },

  setPs: (patch) => {
    const { projectId } = get();
    // Optimistic sync update — UI is instant
    set((s) => ({ ps: { ...s.ps, ...patch } }));
    if (!projectId) return;
    // Async persist — fire and forget with debounced flush
    getStore(projectId).then((store) => {
      for (const [key, value] of Object.entries(patch)) {
        store.set(key, value).catch(console.error);
      }
      scheduleSave(projectId, store);
    }).catch(console.error);
  },

  openComponent: (name) => get().setPs({ activeView: "components", activeComponent: name }),
  openScreen:    (name) => get().setPs({ activeView: "screens",    activeScreen: name }),
  openTheme:     (name) => get().setPs({ activeView: "themes",     activeTheme: name }),
  openWorkflow:  (name) => get().setPs({ activeView: "workflows",  activeWorkflow: name }),
  openApi:       (id)   => get().setPs({ activeView: "apis",       activeApi: id }),
}));
