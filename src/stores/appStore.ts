import { create, type StateCreator } from "zustand";
import { load } from "@tauri-apps/plugin-store";

const SETTINGS_KEY = "settings.json";

export interface Settings {
  view: string;
  modelId: string;
  project: string;
  stylePreset: string;
  dark: boolean;
  accent: string;
  editorTheme: string;
  tweaks: Record<string, unknown>;
  prompts: Record<string, string>;
  styles: Array<{ name: string; value: string }>;
  host: string;
  apiKeys: Record<string, string>;
  ollamaCloudModels: string[];
  provider: "ollama" | "openai" | "claude";
  glow: "off" | "subtle" | "full";
  amoled: boolean;
  iconLibrary: "lucide" | "tabler" | "fontawesome" | "bootstrap" | "material" | "none";
  layout: Record<string, number[]>;
}

const DEFAULT_SETTINGS: Settings = {
  view: "screens",
  modelId: "gemma4-26b-128k:latest",
  project: "default",
  stylePreset: "default",
  dark: true,
  accent: "oklch(0.488 0.243 264.376)",
  editorTheme: "oneDark",
  tweaks: {},
  prompts: {},
  styles: [],
  host: "http://localhost:11434",
  apiKeys: {},
  ollamaCloudModels: [],
  provider: "ollama",
  glow: "subtle",
  amoled: false,
  iconLibrary: "lucide",
  layout: {},
};

// ─── Settings Slice ───

interface SettingsSlice {
  settings: Settings;
  loaded: boolean;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

let storePromise: ReturnType<typeof load> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = load(SETTINGS_KEY, { defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown> });
  }
  return storePromise;
}

let initPromise: Promise<void> | null = null;

function ensureInit(set: (fn: (state: SettingsSlice) => Partial<SettingsSlice>) => void) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const store = await getStore();
    const entries = await store.entries<unknown>();
    const loaded = { ...DEFAULT_SETTINGS };
    for (const [key, value] of entries) {
      if (key in loaded) {
        (loaded as unknown as Record<string, unknown>)[key] = value;
      }
    }
    // Migrate legacy localStorage keys
    if (typeof window !== "undefined") {
      const legacyMap: Record<string, keyof Settings> = {
        "pt.view": "view",
        "pt.model": "modelId",
        "pt.project": "project",
        "pt.stylePreset": "stylePreset",
        "pt.host": "host",
      };
      let migrated = false;
      for (const [legacyKey, settingKey] of Object.entries(legacyMap)) {
        const raw = localStorage.getItem(legacyKey);
        if (raw !== null) {
          (loaded as unknown as Record<string, unknown>)[settingKey] = raw;
          localStorage.removeItem(legacyKey);
          migrated = true;
        }
      }
      if (migrated) {
        for (const [key, value] of Object.entries(loaded)) {
          await store.set(key, value);
        }
        await store.save();
      }
    }
    set(() => ({ settings: loaded, loaded: true }));
  })();
  return initPromise;
}

const createSettingsSlice: StateCreator<SettingsSlice> = (set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  setSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    const store = await getStore();
    for (const [key, value] of Object.entries(patch)) {
      await store.set(key, value);
    }
    await store.save();
  },
});

export const useAppStore = create<SettingsSlice>()((...args) => {
  const [set] = args;
  ensureInit(set);
  return {
    ...createSettingsSlice(...args),
  };
});
