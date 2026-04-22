import { useCallback, useEffect, useState } from "react";
import { load } from "@tauri-apps/plugin-store";

const SETTINGS_KEY = "settings.json";

export interface Settings {
  view: string;
  modelId: string;
  project: string;
  stylePreset: string;
  tweaks: Record<string, unknown>;
  prompts: Record<string, string>;
  styles: Array<{ name: string; value: string }>;
  host: string;
  apiKeys: Record<string, string>;
}

const DEFAULT_SETTINGS: Settings = {
  view: "screens",
  modelId: "qwen2.5-coder:32b",
  project: "default",
  stylePreset: "default",
  tweaks: {},
  prompts: {},
  styles: [],
  host: "http://localhost:11434",
  apiKeys: {},
};

let storePromise: ReturnType<typeof load> | null = null;

function getStore() {
  if (!storePromise) {
    storePromise = load(SETTINGS_KEY, { defaults: DEFAULT_SETTINGS as unknown as Record<string, unknown> });
  }
  return storePromise;
}

export function useSettings() {
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore();
      const entries = await store.entries<unknown>();
      const loadedSettings = { ...DEFAULT_SETTINGS };
      for (const [key, value] of entries) {
        if (key in loadedSettings) {
          (loadedSettings as unknown as Record<string, unknown>)[key] = value;
        }
      }
      if (!cancelled) {
        setSettingsState(loadedSettings);
        setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const store = await getStore();
    const next = { ...settings, ...patch };
    setSettingsState(next);
    for (const [key, value] of Object.entries(patch)) {
      await store.set(key, value);
    }
    await store.save();
  }, [settings]);

  return { settings, setSettings, loaded };
}
