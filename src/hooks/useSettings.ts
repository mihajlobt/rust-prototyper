import { useCallback, useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";

const SETTINGS_KEY = "settings.json";

export interface Settings {
  view: string;
  modelId: string;
  project: string;
  stylePreset: string;
  dark: boolean;
  tweaks: Record<string, unknown>;
  prompts: Record<string, string>;
  styles: Array<{ name: string; value: string }>;
  host: string;
  apiKeys: Record<string, string>;
}

const DEFAULT_SETTINGS: Settings = {
  view: "screens",
  modelId: "gemma4-26b-128k:latest",
  project: "default",
  stylePreset: "default",
  dark: true,
  tweaks: {},
  prompts: {},
  styles: [],
  host: "http://localhost:11434",
  apiKeys: {},
};

// Module-level shared state — all useSettings() instances share one copy
let sharedSettings: Settings = DEFAULT_SETTINGS;
let sharedLoaded = false;
const listeners = new Set<(s: Settings) => void>();
let storePromise: ReturnType<typeof load> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = load(SETTINGS_KEY, { defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown> });
  }
  return storePromise;
}

function broadcast(next: Settings) {
  sharedSettings = next;
  listeners.forEach((fn) => fn(next));
}

// Load once on first call
let initPromise: Promise<void> | null = null;
function ensureInit() {
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
    sharedLoaded = true;
    broadcast(loaded);
  })();
  return initPromise;
}

export function useSettings() {
  const [settings, setLocalSettings] = useState<Settings>(sharedSettings);
  const [loaded, setLoaded] = useState(sharedLoaded);

  useEffect(() => {
    // Subscribe to shared state changes
    const handler = (next: Settings) => {
      setLocalSettings(next);
      setLoaded(true);
    };
    listeners.add(handler);
    // Trigger init (no-op if already started)
    ensureInit();
    return () => { listeners.delete(handler); };
  }, []);

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const next = { ...sharedSettings, ...patch };
    broadcast(next); // instant — all subscribers update synchronously
    const store = await getStore();
    for (const [key, value] of Object.entries(patch)) {
      await store.set(key, value);
    }
    await store.save();
  }, []);

  return { settings, setSettings, loaded };
}
