// ─── Storage helpers, cURL parser, TS inference, project sync, service gen ───

import { notify } from "@/hooks/useToast";
import { readFile, writeFile, createDir, getErrorMessage } from "@/lib/ipc";
import { getGeneratedViteConfig } from "@/lib/scaffold-shadcn";
import type { ApiKey, SavedApi } from "./types";

// ── Project paths ──

function getApisPath(project: string) { return `projects/${project}/apis/apis.json`; }
function getEnvPath(project: string) { return `projects/${project}/apis/env.json`; }
function getKeysPath(project: string) { return `projects/${project}/apis/keys.json`; }

// ── Load / save APIs, env vars, keys (used in panel useEffects) ──

export async function loadEnvVars(project: string): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(getEnvPath(project))); } catch { return {}; }
}
export async function saveEnvVars(project: string, envVars: Record<string, string>) {
  try {
    const p = getEnvPath(project);
    await createDir(p.replace("/env.json", ""));
    await writeFile(p, JSON.stringify(envVars, null, 2));
  } catch (e) { notify.error("Failed to save env vars", getErrorMessage(e)); }
}
export async function loadApis(project: string): Promise<SavedApi[]> {
  try { return JSON.parse(await readFile(getApisPath(project))); } catch { return []; }
}
export async function saveApis(project: string, apis: SavedApi[]) {
  try {
    const p = getApisPath(project);
    await createDir(p.replace("/apis.json", ""));
    await writeFile(p, JSON.stringify(apis, null, 2));
  } catch (e) { notify.error("Failed to save APIs", getErrorMessage(e)); }
}
export async function loadApiKeys(project: string): Promise<ApiKey[]> {
  try { return JSON.parse(await readFile(getKeysPath(project))); } catch { return []; }
}
export async function saveApiKeys(project: string, keys: ApiKey[]) {
  try {
    const p = getKeysPath(project);
    await createDir(p.replace("/keys.json", ""));
    await writeFile(p, JSON.stringify(keys, null, 2));
  } catch (e) { notify.error("Failed to save API keys", getErrorMessage(e)); }
}

// ── ID generator (used when creating APIs, keys, and OpenAPI imports) ──

export function generateId() { return `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

// ── cURL paste parser — extracts method, URL, headers, body ──

export function parseCurl(input: string): Partial<SavedApi> | null {
  const normalized = input.replace(/\\\n/g, " ").replace(/\n/g, " ").trim();
  const methodMatch = normalized.match(/curl\s+(?:-X\s+|--request\s+)(\w+)\s+['"]?(https?:\/\/[^\s'"]+)['"]?/i)
    || normalized.match(/curl\s+['"]?(https?:\/\/[^\s'"]+)['"]?/i);
  if (!methodMatch) return null;
  const url = methodMatch[2] || methodMatch[1];
  const method = methodMatch[1] && /^https?:\/\//i.test(methodMatch[1]) ? "GET" : (methodMatch[1] || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  for (const m of normalized.matchAll(/(?:-H|--header)\s+['"]([^'"]+?)['"]/g)) {
    const idx = m[1].indexOf(":");
    if (idx > 0) headers[m[1].slice(0, idx).trim()] = m[1].slice(idx + 1).trim();
  }
  const bodyMatch = normalized.match(/(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]\s*(?:-H|-X|curl|$)/i)
    || normalized.match(/(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]\s*$/i);
  return { url, method, headersText: JSON.stringify(headers, null, 2), body: bodyMatch ? bodyMatch[1] : "" };
}

// ── TypeScript type inference from a JSON response body ──

export function jsonToTsInterface(name: string, json: unknown): string {
  const INDENT = "  ";
  function inferType(val: unknown, depth = 0): string {
    if (val === null) return "null";
    if (Array.isArray(val)) {
      if (val.length === 0) return "unknown[]";
      return `Array<${inferType(val[0], depth)}>`;
    }
    if (typeof val === "object") {
      const pad = INDENT.repeat(depth + 1);
      const closePad = INDENT.repeat(depth);
      const lines = Object.entries(val as Record<string, unknown>).map(
        ([k, v]) => `${pad}${/[^a-zA-Z0-9_$]/.test(k) ? `"${k}"` : k}: ${inferType(v, depth + 1)};`
      );
      return `{\n${lines.join("\n")}\n${closePad}}`;
    }
    return typeof val;
  }
  try {
    const body = inferType(json);
    // interface syntax only works for object bodies — arrays and primitives need type alias
    if (Array.isArray(json) || typeof json !== "object" || json === null) {
      return `export type ${name} = ${body}`;
    }
    return `export interface ${name} ${body}`;
  } catch {
    return `// Could not infer type from response`;
  }
}

export function buildInterfaceName(apiName: string): string {
  return apiName.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) + "Response";
}

// ── Sync API keys + proxy config to the generated project ──

export async function syncToProject(project: string, keys: ApiKey[], apis: SavedApi[]) {
  const generatedDir = `projects/${project}/generated`;
  try {
    await createDir(generatedDir);

    // .env.local
    const envLines = keys
      .filter((k) => k.name.trim() && k.value.trim())
      .map((k) => `VITE_${k.name.toUpperCase().replace(/\W+/g, "_")}=${k.value.replace(/[\r\n]/g, "")}`);
    await writeFile(`${generatedDir}/.env.local`, envLines.join("\n") + (envLines.length ? "\n" : ""));

    // proxy.config.json + vite.config.ts
    // Values store origin+pathname (e.g. "https://api.openweathermap.org/data/2.5/weather")
    // so the vite proxy can rewrite the path correctly.
    const proxy: Record<string, string> = {};
    for (const api of apis) {
      if (api.proxyPath?.trim() && api.url?.trim()) {
        try {
          const parsed = new URL(api.url);
          const fullPath = parsed.origin + parsed.pathname;
          // Reject values that would break TS string interpolation in vite.config.ts
          if (!fullPath.includes('"') && !fullPath.includes('\\')) {
            proxy[api.proxyPath] = fullPath;
          }
        } catch { /* skip invalid URL */ }
      }
    }
    await writeFile(`${generatedDir}/proxy.config.json`, JSON.stringify(proxy, null, 2));
    await writeFile(`${generatedDir}/vite.config.ts`, getGeneratedViteConfig(proxy));

    notify.success("Synced to project", `.env.local and vite.config.ts updated`);
  } catch (e) {
    notify.error("Sync failed", getErrorMessage(e));
  }
}

// ── Build a TanStack Query service file from an API definition ──

export function buildServiceFile(api: SavedApi, tsInterface: string, interfaceName: string): string {
  const slug = api.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const hookName =
    "use" +
    api.name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
  const base = api.url;
  const queryKey = slug.replace(/-/g, "_");

  return `import { useQuery } from '@tanstack/react-query'

${tsInterface}

export function ${hookName}(params?: Record<string, string>) {
  const search = params ? '?' + new URLSearchParams(params).toString() : ''
  return useQuery({
    queryKey: ['${queryKey}', params],
    queryFn: async (): Promise<${interfaceName}> => {
      const res = await fetch(\`${base}\${search}\`)
      if (!res.ok) throw new Error(\`API error: \${res.status}\`)
      return res.json()
    },
    staleTime: 1000 * 60, // 1 minute
  })
}
`;
}
