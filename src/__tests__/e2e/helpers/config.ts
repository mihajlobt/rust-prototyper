import fs from "node:fs/promises";
import path from "node:path";

export const DATA_DIR = path.join(
  process.env.HOME ?? "/home/m",
  ".local/share/com.m.prototyper",
);

let _settings: Record<string, unknown> | null = null;

async function readSettings(): Promise<Record<string, unknown>> {
  if (!_settings) {
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, "settings.json"), "utf8");
      _settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      _settings = {};
    }
  }
  return _settings!;
}

export async function getOllamaConfig(): Promise<{ host: string; key: string }> {
  const host = process.env.OLLAMA_CLOUD_HOST;
  const key = process.env.OLLAMA_CLOUD_KEY;
  if (host && key) return { host, key };

  const settings = await readSettings();
  const apiKeys = (settings.apiKeys ?? {}) as Record<string, string>;
  return {
    host: host ?? "https://ollama.com",
    key: key ?? apiKeys["ollama"] ?? "",
  };
}

export async function requireTestProjectDir(): Promise<string> {
  const dir = process.env.PROTOTYPER_TEST_PROJECT;
  if (dir) return dir;
  const settings = await readSettings();
  const projectId = (settings.project as string | undefined) ?? "";
  if (!projectId) {
    throw new Error(
      "Cannot determine test project: set PROTOTYPER_TEST_PROJECT env var " +
        "or open a project in Prototyper so settings.json has a 'project' key.",
    );
  }
  return path.join(DATA_DIR, "projects", projectId);
}

export const MODEL = "minimax-m2.5";

export function componentPreviewDir(projectDir: string): string {
  return path.join(projectDir, "component-preview");
}

export function screenPreviewDir(projectDir: string): string {
  return path.join(projectDir, "screen-preview");
}
