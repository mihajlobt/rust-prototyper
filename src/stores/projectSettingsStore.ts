import { create } from "zustand";
import { load } from "@tauri-apps/plugin-store";

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateMode = "wizard" | "screens" | "components" | "themes";

const isCreateMode = (s: string): s is CreateMode =>
  s === "wizard" || s === "screens" || s === "components" || s === "themes";

export interface ProjectSettings {
  // Navigation — which item is open in each panel
  activeView: string;
  activeComponent: string | null;
  activeScreen: string | null;
  activeTheme: string | null;
  activeWorkflow: string | null;
  activeApi: string | null;
  activePlan: string | null;

  /** Sub-mode of the merged Create panel. */
  createMode: CreateMode;

  // Plans panel prefs
  plansMode: "write" | "split" | "read" | "focus";
  plansChatOpen: boolean;
  plansShowInspector: boolean;

  // Project configuration
  stylePreset: string;
  directories: {
    themes: string;
    components: string;
    screens: string;
  };

  // Global preview dark mode — one toggle for all panels
  darkPreview: boolean;

  // Create panel — shared per-mode state
  createDevice: "desktop" | "tablet" | "mobile";
  createZoom: number;
  createShowInspector: boolean;
  createCodeOpen: boolean;
  createCodeTab: "editor" | "links" | "flow";
  /** Themes-only code tab. The third tab's value is the string "guidelines" —
   *  the visible label is "Design" but the stored value matches the original
   *  ThemeCodeTabs.tsx:13 typing. */
  createCodeTab2: "css" | "tokens" | "guidelines";
  /** Theme applied to the live preview only — independent of the generation
   *  design language (stylePreset). */
  createPreviewTheme: string;

  // Create panel — themes-only state
  createGenerationMode: "css" | "design";
  createPreviewMode: "preview" | "gallery";

  // Runner panel
  runnerDevice: "desktop" | "tablet" | "mobile";
  runnerZoom: number;
  runnerTerminalOpen: boolean;
  runnerPreviewOpen: boolean;
  runnerActiveTab: "terminal" | "logs" | "network";
  runnerEditorTabs: string[];
  runnerEditorActiveTabPath: string | null;
  runnerExpandedDirs: string[];
  runnerRequestedFile: string | null;
  runnerRequestedDiffTab: string | null;
  runnerPort: number;

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

  // Assets panel
  assetsViewMode: "list" | "grid";
  assetsShowLog: boolean;
  assetsSortOrder: "newest" | "oldest" | "largest" | "smallest" | "name";
  assetsSteps: number;
  assetsPreset: number;
}

export const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  activeView: "create",
  createMode: "screens",
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
  directories: {
    themes: "src/styles/themes",
    components: "src/components",
    screens: "src/screens",
  },

  createDevice: "desktop",
  createZoom: 1,
  createShowInspector: false,
  createCodeOpen: false,
  createCodeTab: "editor",
  createCodeTab2: "css",
  createPreviewTheme: "",

  createGenerationMode: "design",
  createPreviewMode: "preview",

  runnerDevice: "desktop",
  runnerZoom: 1,
  runnerTerminalOpen: true,
  runnerPreviewOpen: true,
  runnerActiveTab: "terminal",
  runnerEditorTabs: [],
  runnerEditorActiveTabPath: null,
  runnerExpandedDirs: [],
  runnerRequestedFile: null,
  runnerRequestedDiffTab: null,
  runnerPort: 5174,

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

  assetsViewMode: "list",
  assetsShowLog: true,
  assetsSortOrder: "newest",
  assetsSteps: 4,
  assetsPreset: 0,
};

// ─── Store handle cache — one open handle per project ─────────────────────────

const storeCache = new Map<string, Awaited<ReturnType<typeof load>>>();

async function getStore(projectId: string) {
  if (!storeCache.has(projectId)) {
    const store = await load(`project-${projectId}.json`);
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

  /** Switch to the Create panel and (optionally) select an item. */
  openCreate: (mode: CreateMode, itemName: string | null) => void;

  // Navigation helpers (per-panel)
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
    // Start from defaults, then overlay disk values for any key declared
    // on the new ProjectSettings. Old keys present on disk
    // (wizardDevice, screensCodeTab, themesFramework, shadcnMode, etc.) are
    // extra JSON keys and are silently ignored — they are not a code path.
    const loaded: ProjectSettings = { ...DEFAULT_PROJECT_SETTINGS };
    for (const [key, value] of entries) {
      // `Object.prototype.hasOwnProperty.call` checks a key is declared on the
      // default object without using a cast. The assignment goes through a
      // typed Partial<ProjectSettings> accumulator.
      if (Object.prototype.hasOwnProperty.call(DEFAULT_PROJECT_SETTINGS, key)) {
        Reflect.set(loaded, key, value);
      }
    }
    // One-shot: if a pre-merge settings.json has activeView set to one of the
    // four legacy Create sub-mode values, snap the user into the merged panel
    // on the right sub-mode. No-op on every subsequent load.
    if (isCreateMode(loaded.activeView)) {
      loaded.createMode = loaded.activeView;
      loaded.activeView = "create";
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

  openCreate: (mode, itemName) => {
    const patch: Partial<ProjectSettings> = { activeView: "create", createMode: mode };
    if (mode === "screens" && itemName)    patch.activeScreen    = itemName;
    if (mode === "components" && itemName) patch.activeComponent = itemName;
    if (mode === "themes" && itemName)     patch.activeTheme     = itemName;
    // Wizard ignores itemName — wizard is project-level, no per-entity selection.
    get().setProjectSettings(patch);
  },

  openWorkflow:   (name) => get().setProjectSettings({ activeView: "workflows",  activeWorkflow: name }),
  openApi:        (id)   => get().setProjectSettings({ activeView: "apis",       activeApi: id }),
  openPlan:       (name) => get().setProjectSettings({ activeView: "plans",      activePlan: name }),
  openRunnerFile: (path) => get().setProjectSettings({ activeView: "runner",     runnerRequestedFile: path }),
  openRunnerDiffTab: (tabId) => get().setProjectSettings({ activeView: "runner", runnerRequestedDiffTab: tabId }),
}));
