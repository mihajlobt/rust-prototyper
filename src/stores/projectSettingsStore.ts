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
  activePlan: string | null;

  // Plans panel prefs
  plansMode: "write" | "split" | "read" | "focus";
  plansChatOpen: boolean;
  plansShowInspector: boolean;

  // Project configuration
  stylePreset: string;
  /** When true, the active design language's DESIGN.md is auto-injected as the brief
   *  for screen/component generation. Toggled off to remove it. */
  applyDesignBrief: boolean;
  directories: {
    themes: string;
    components: string;
    screens: string;
  };

  // Global preview dark mode — one toggle for all panels
  darkPreview: boolean;

  // Screens panel
  screensDevice: "desktop" | "tablet" | "mobile";
  screensZoom: number;
  screensShowInspector: boolean;
  screensCodeOpen: boolean;
  screensCodeTab: "editor" | "links" | "flow";
  /** Theme applied to the live screen preview only — independent of the
   *  generation design language (stylePreset). */
  screensPreviewTheme: string;

  // Components panel
  componentsDevice: "desktop" | "tablet" | "mobile";
  componentsShowInspector: boolean;
  componentsCodeOpen: boolean;
  /** Theme applied to the live component preview only — independent of the
   *  generation design language (stylePreset). */
  componentsPreviewTheme: string;

  // Themes panel
  themesDevice: "desktop" | "tablet" | "mobile";
  themesShowInspector: boolean;
  themesCodeOpen: boolean;
  themesFramework: "shadcn" | "daisy" | "bootstrap" | "generic";
  themesDarkLightSupport: boolean;
  themesGenerationMode: "css" | "design";
  themesPreviewMode: "preview" | "gallery";

  // Runner panel
  runnerDevice: "desktop" | "tablet" | "mobile";
  runnerZoom: number;
  runnerTerminalOpen: boolean;
  runnerActiveTab: "terminal" | "logs" | "network";
  runnerEditorTabs: string[];
  runnerEditorActiveTabPath: string | null;
  runnerExpandedDirs: string[];
  runnerRequestedFile: string | null;
  runnerRequestedDiffTab: string | null;

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
  apisProxyPath: string;
  apisShowInspector: boolean;
  apisSidebarTab: "collection" | "keys";

  // Component preview
  shadcnMode: boolean;
  runnerPort: number;

  // Assets panel
  assetsViewMode: "list" | "grid";
  assetsShowLog: boolean;
  assetsSortOrder: "newest" | "oldest" | "largest" | "smallest" | "name";
  assetsSteps: number;
  assetsPreset: number;

  // Wizard panel
  wizardDevice: "desktop" | "tablet" | "mobile";
  wizardShowInspector: boolean;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  activeView: "screens",
  activeComponent: null,
  activeScreen: null,
  activeTheme: null,
  activeWorkflow: null,
  activeApi: null,
  activePlan: null,

  darkPreview: false,

  plansMode: "split",
  plansChatOpen: false,
  plansShowInspector: false,

  stylePreset: "",
  applyDesignBrief: true,
  directories: {
    themes: "src/styles/themes",
    components: "src/components",
    screens: "src/screens",
  },

  screensDevice: "desktop",
  screensZoom: 1,
  screensShowInspector: false,
  screensCodeOpen: false,
  screensCodeTab: "editor",
  screensPreviewTheme: "",

  componentsDevice: "desktop",
  componentsShowInspector: false,
  componentsCodeOpen: false,
  componentsPreviewTheme: "",

  themesDevice: "desktop",
  themesShowInspector: false,
  themesCodeOpen: false,
  themesFramework: "shadcn",
  themesDarkLightSupport: true,
  themesGenerationMode: "design",
  themesPreviewMode: "preview",

  runnerDevice: "desktop",
  runnerZoom: 1,
  runnerTerminalOpen: true,
  runnerActiveTab: "terminal",
  runnerEditorTabs: [],
  runnerEditorActiveTabPath: null,
  runnerExpandedDirs: [],
  runnerRequestedFile: null,
  runnerRequestedDiffTab: null,

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
  apisProxyPath: "",
  apisShowInspector: false,
  apisSidebarTab: "collection",

  shadcnMode: true,
  runnerPort: 5174,

  assetsViewMode: "list",
  assetsShowLog: true,
  assetsSortOrder: "newest",
  assetsSteps: 4,
  assetsPreset: 0,

  wizardDevice: "desktop",
  wizardShowInspector: false,
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
  setProjectSettings: (patch: Partial<ProjectSettings>) => void;

  // Navigation helpers
  openComponent: (name: string) => void;
  openScreen: (name: string) => void;
  openTheme: (name: string) => void;
  openWorkflow: (name: string) => void;
  openApi: (id: string) => void;
  openPlan: (name: string) => void;
  openRunnerFile: (path: string) => void;
  openRunnerDiffTab: (tabId: string) => void;
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
    // Coerce legacy "both" generation mode to "design"
    if ((loaded as unknown as Record<string, unknown>).themesGenerationMode === "both") {
      (loaded as unknown as Record<string, unknown>).themesGenerationMode = "design";
    }
    // Coerce legacy "ports" tab to "links"
    if ((loaded as unknown as Record<string, unknown>).screensCodeTab === "ports") {
      (loaded as unknown as Record<string, unknown>).screensCodeTab = "links";
    }
    // Migrate per-panel dark preview flags to unified darkPreview
    {
      const r = loaded as unknown as Record<string, unknown>;
      if (r.screensDarkPreview || r.componentsDarkPreview || r.themesDarkPreview || r.runnerDarkPreview || r.wizardDarkPreview) {
        r.darkPreview = true;
      }
    }
    set({ projectId, ps: loaded, loaded: true });
  },

  setProjectSettings: (patch) => {
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

  openComponent:  (name) => get().setProjectSettings({ activeView: "components", activeComponent: name }),
  openScreen:     (name) => get().setProjectSettings({ activeView: "screens",    activeScreen: name }),
  openTheme:      (name) => get().setProjectSettings({ activeView: "themes",     activeTheme: name }),
  openWorkflow:   (name) => get().setProjectSettings({ activeView: "workflows",  activeWorkflow: name }),
  openApi:        (id)   => get().setProjectSettings({ activeView: "apis",       activeApi: id }),
  openPlan:       (name) => get().setProjectSettings({ activeView: "plans",      activePlan: name }),
  openRunnerFile: (path) => get().setProjectSettings({ activeView: "runner",     runnerRequestedFile: path }),
  openRunnerDiffTab: (tabId) => get().setProjectSettings({ activeView: "runner", runnerRequestedDiffTab: tabId }),
}));
