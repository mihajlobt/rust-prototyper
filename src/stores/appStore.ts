import { create, type StateCreator } from "zustand";
import { load } from "@tauri-apps/plugin-store";
import { useProjectSettingsStore } from "./projectSettingsStore";

const SETTINGS_KEY = "settings.json";

export type Provider = "ollama-local" | "ollama-cloud" | "openai" | "claude";

export type ToolPermissionMode = "ask_every_time" | "auto_accept_read_only" | "auto_accept_all";

/** Ollama generation options — all fields optional; omitted fields use Ollama's defaults. */
export interface OllamaModelOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  numCtx?: number;
  numPredict?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  seed?: number;
  mirostat?: number;
  mirostatTau?: number;
  mirostatEta?: number;
  tfsZ?: number;
}

export interface Settings {
  modelId: string;
  project: string;
  dark: boolean;
  accent: string;
  editorTheme: string;
  tweaks: Record<string, unknown>;
  prompts: Record<string, string>;
  styles: Array<{ name: string; value: string }>;
  host: string;
  apiKeys: Record<string, string>;
  provider: Provider;
  glow: "off" | "subtle" | "full";
  amoled: boolean;
  iconLibrary: "lucide" | "tabler" | "fontawesome" | "bootstrap" | "material" | "none";
  layout: Record<string, number[]>;
  modelOptions: OllamaModelOptions;
  toolPermissionMode: ToolPermissionMode;
  toolAllowlist: string[];
}

const DEFAULT_SETTINGS: Settings = {
  modelId: "gemma4-26b-128k:latest",
  project: "default",
  dark: true,
  accent: "oklch(0.488 0.243 264.376)",
  editorTheme: "oneDark",
  tweaks: {},
  prompts: {},
  styles: [],
  host: "http://localhost:11434",
  apiKeys: {},
  provider: "ollama-local",
  glow: "subtle",
  amoled: false,
  iconLibrary: "lucide",
  layout: {},
  modelOptions: {},
  toolPermissionMode: "ask_every_time",
  toolAllowlist: [],
};

/** Derive provider from host + API key. Provider is NOT stored — it's computed. */
export function inferProvider(host: string, apiKeys: Record<string, string>): Provider {
  if (host === "https://ollama.com") {
    return apiKeys["ollama"] ? "ollama-cloud" : "ollama-local"
  }
  return "ollama-local"
}

// ─── Settings Slice ───

interface SettingsSlice {
  settings: Settings;
  loaded: boolean;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Set host and auto-derive provider */
  setHost: (host: string) => Promise<void>;
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
    // Migrate legacy provider value: "ollama" → "ollama-local"
    if ((loaded as unknown as Record<string, unknown>).provider === "ollama") {
      (loaded as unknown as Record<string, unknown>).provider = "ollama-local";
    }
    // Migrate legacy localStorage keys
    if (typeof window !== "undefined") {
      const legacyMap: Record<string, keyof Settings> = {
        "pt.model": "modelId",
        "pt.project": "project",
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
    // Load per-project settings for the active project
    await useProjectSettingsStore.getState().loadProject(loaded.project);
  })();
  return initPromise;
}

const createSettingsSlice: StateCreator<SettingsSlice> = (set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  setSettings: async (patch) => {
    const prev = get().settings;
    const next = { ...prev, ...patch };
    set({ settings: next });
    const store = await getStore();
    for (const [key, value] of Object.entries(patch)) {
      await store.set(key, value);
    }
    await store.save();
    // When project switches, load its persisted settings
    if (patch.project && patch.project !== prev.project) {
      await useProjectSettingsStore.getState().loadProject(patch.project);
    }
  },
  setHost: async (host) => {
    const { settings } = get();
    const provider = inferProvider(host, settings.apiKeys);
    await get().setSettings({ host, provider });
  },
});

export const useAppStore = create<SettingsSlice>()((...args) => {
  const [set] = args;
  ensureInit(set);
  return {
    ...createSettingsSlice(...args),
  };
});