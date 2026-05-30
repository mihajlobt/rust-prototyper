import { useState, useEffect, useCallback } from "react";
import { Allotment } from "allotment";
import {
  Send, Plus, Trash2, Save, Copy, Key, RefreshCw, Database, X, Plug, Globe, Terminal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  httpRequest, readFile, writeFile, createDir, getErrorMessage,
} from "@/lib/ipc";
import { getGeneratedViteConfig } from "@/lib/scaffold-shadcn";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore, type ApiHistoryEntry } from "@/stores/uiStore";
import { notify } from "@/hooks/useToast";
import YAML from "js-yaml";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedApi {
  id: string;
  name: string;
  method: string;
  url: string;
  headersText: string;
  body: string;
  authType: "none" | "bearer" | "apikey" | "basic" | "oauth2";
  authToken: string;
  authHeaderName: string;
  authUsername: string;
  authPassword: string;
  authTokenUrl: string;
  authClientId: string;
  authClientSecret: string;
  proxyPath: string;
  history: ApiHistoryEntry[];
}

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  description: string;
}

// ─── Pre-configured API Templates ────────────────────────────────────────────

const API_TEMPLATES: Array<Omit<SavedApi, "id" | "history"> & { description: string }> = [
  {
    name: "OpenWeatherMap — Current Weather",
    method: "GET",
    url: "https://api.openweathermap.org/data/2.5/weather?lat=51.51&lon=-0.13&units=metric&appid={{OPENWEATHERMAP_KEY}}",
    headersText: "{}",
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/weather",
    description: "Real-time weather (London). Free key at openweathermap.org → add OPENWEATHERMAP_KEY to Keys",
  },
  {
    name: "OpenWeatherMap — Forecast",
    method: "GET",
    url: "https://api.openweathermap.org/data/2.5/forecast?lat=51.51&lon=-0.13&cnt=8&units=metric&appid={{OPENWEATHERMAP_KEY}}",
    headersText: "{}",
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/weather",
    description: "5-day / 3-hour forecast (London). Same key as current weather.",
  },
  {
    name: "GitHub — Search Repos",
    method: "GET",
    url: "https://api.github.com/search/repositories?q=react&sort=stars",
    headersText: JSON.stringify({ "User-Agent": "Prototyper", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, null, 2),
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/github",
    description: "Search public repositories. No API key needed.",
  },
  {
    name: "GitHub — User Profile",
    method: "GET",
    url: "https://api.github.com/users/octocat",
    headersText: JSON.stringify({ "User-Agent": "Prototyper", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" }, null, 2),
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/github",
    description: "Fetch any GitHub user profile. No key needed.",
  },
  {
    name: "JSONPlaceholder — Posts",
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/posts",
    headersText: "{}",
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/fake",
    description: "Fake REST API for prototyping. Always works, no key needed.",
  },
  {
    name: "JSONPlaceholder — Users",
    method: "GET",
    url: "https://jsonplaceholder.typicode.com/users",
    headersText: "{}",
    body: "",
    authType: "none",
    authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
    authTokenUrl: "", authClientId: "", authClientSecret: "",
    proxyPath: "/api/fake",
    description: "Fake users list with name, email, address fields.",
  },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function getApisPath(project: string) { return `projects/${project}/apis/apis.json`; }
function getEnvPath(project: string) { return `projects/${project}/apis/env.json`; }
function getKeysPath(project: string) { return `projects/${project}/apis/keys.json`; }

async function loadEnvVars(project: string): Promise<Record<string, string>> {
  try { return JSON.parse(await readFile(getEnvPath(project))); } catch { return {}; }
}
async function saveEnvVars(project: string, envVars: Record<string, string>) {
  try {
    const p = getEnvPath(project);
    await createDir(p.replace("/env.json", ""));
    await writeFile(p, JSON.stringify(envVars, null, 2));
  } catch (e) { notify.error("Failed to save env vars", getErrorMessage(e)); }
}
async function loadApis(project: string): Promise<SavedApi[]> {
  try { return JSON.parse(await readFile(getApisPath(project))); } catch { return []; }
}
async function saveApis(project: string, apis: SavedApi[]) {
  try {
    const p = getApisPath(project);
    await createDir(p.replace("/apis.json", ""));
    await writeFile(p, JSON.stringify(apis, null, 2));
  } catch (e) { notify.error("Failed to save APIs", getErrorMessage(e)); }
}
async function loadApiKeys(project: string): Promise<ApiKey[]> {
  try { return JSON.parse(await readFile(getKeysPath(project))); } catch { return []; }
}
async function saveApiKeys(project: string, keys: ApiKey[]) {
  try {
    const p = getKeysPath(project);
    await createDir(p.replace("/keys.json", ""));
    await writeFile(p, JSON.stringify(keys, null, 2));
  } catch (e) { notify.error("Failed to save API keys", getErrorMessage(e)); }
}

function generateId() { return `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`; }

function parseCurl(input: string): Partial<SavedApi> | null {
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

// ─── TypeScript type inference from JSON ──────────────────────────────────────

function jsonToTsInterface(name: string, json: unknown): string {
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
    return `export interface ${name} ${inferType(json)}`;
  } catch {
    return `// Could not infer type from response`;
  }
}

function buildInterfaceName(apiName: string): string {
  return apiName.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase()) + "Response";
}

// ─── Sync API keys + proxy to the generated project ──────────────────────────

async function syncToProject(project: string, keys: ApiKey[], apis: SavedApi[]) {
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

// ─── Generate service file ────────────────────────────────────────────────────

function buildServiceFile(api: SavedApi, tsInterface: string, interfaceName: string): string {
  const slug = api.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const hookName =
    "use" +
    api.name.replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toUpperCase());
  const base = api.proxyPath?.trim() || api.url.replace(/\/[^/]*$/, "");
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

// ─── Component ────────────────────────────────────────────────────────────────

export function APIsPanel() {
  const { settings } = useAppStore();
  const { ps, setPs, openApi } = useProjectSettingsStore();
  const selectedApiId = ps.activeApi;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("apis", 2);

  const [apis, setApis] = useState<SavedApi[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [sidebarTab, setSidebarTab] = useState<"collection" | "keys">("collection");
  const [showTemplates, setShowTemplates] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyDesc, setNewKeyDesc] = useState("");
  const [generatingService, setGeneratingService] = useState(false);

  // Persistent editor state
  const name = ps.apisName;
  const method = ps.apisMethod;
  const url = ps.apisUrl;
  const headersText = ps.apisHeadersText;
  const body = ps.apisBody;
  const authType = ps.apisAuthType;
  const authToken = ps.apisAuthToken;
  const authHeaderName = ps.apisAuthHeaderName;
  const authUsername = ps.apisAuthUsername;
  const authPassword = ps.apisAuthPassword;
  const authTokenUrl = ps.apisAuthTokenUrl;
  const authClientId = ps.apisAuthClientId;
  const authClientSecret = ps.apisAuthClientSecret;
  const proxyPath = ps.apisProxyPath ?? "";

  // Ephemeral state
  const response = useUIStore((s) => s.apisResponse);
  const history = useUIStore((s) => s.apisHistory);
  const envVars = useUIStore((s) => s.apisEnvVars);
  const newEnvKey = useUIStore((s) => s.apisNewEnvKey);
  const newEnvValue = useUIStore((s) => s.apisNewEnvValue);
  const curlPaste = useUIStore((s) => s.apisCurlPaste);
  const openapiPaste = useUIStore((s) => s.apisOpenapiPaste);
  const setUI = useUIStore.setState;

  const [oauthCode, setOauthCode] = useState("");
  const [showOauthDialog, setShowOauthDialog] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load from FS on project change
  useEffect(() => {
    let cancelled = false;
    loadApis(settings.project).then((data) => { if (!cancelled) setApis(data); });
    loadEnvVars(settings.project).then((data) => { if (!cancelled) setUI({ apisEnvVars: data }); });
    loadApiKeys(settings.project).then((data) => { if (!cancelled) setApiKeys(data); });
    return () => { cancelled = true; };
  }, [settings.project, setUI]);

  useEffect(() => { saveApis(settings.project, apis); }, [apis, settings.project]);
  useEffect(() => { saveEnvVars(settings.project, envVars); }, [envVars, settings.project]);
  useEffect(() => { saveApiKeys(settings.project, apiKeys); }, [apiKeys, settings.project]);

  const selectApi = useCallback((api: SavedApi) => {
    openApi(api.id);
    setPs({
      apisName: api.name,
      apisMethod: api.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
      apisUrl: api.url,
      apisHeadersText: api.headersText,
      apisBody: api.body,
      apisAuthType: api.authType,
      apisAuthToken: api.authToken,
      apisAuthHeaderName: api.authHeaderName || "X-API-Key",
      apisAuthUsername: api.authUsername || "",
      apisAuthPassword: api.authPassword || "",
      apisAuthTokenUrl: api.authTokenUrl || "",
      apisAuthClientId: api.authClientId || "",
      apisAuthClientSecret: api.authClientSecret || "",
      apisProxyPath: api.proxyPath || "",
    });
    setUI({ apisHistory: api.history || [], apisResponse: null, apisCurlPaste: "", apisOpenapiPaste: "" });
  }, [openApi, setPs, setUI]);

  function resolveEnvVars(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);
  }

  const createApi = () => {
    const api: SavedApi = {
      id: generateId(), name: "New API", method: "GET", url: "", headersText: "{}",
      body: "", authType: "none", authToken: "", authHeaderName: "X-API-Key",
      authUsername: "", authPassword: "", authTokenUrl: "", authClientId: "",
      authClientSecret: "", proxyPath: "", history: [],
    };
    setApis((prev) => [...prev, api]);
    selectApi(api);
  };

  const addFromTemplate = (tmpl: typeof API_TEMPLATES[number]) => {
    const api: SavedApi = { ...tmpl, id: generateId(), history: [] };
    setApis((prev) => [...prev, api]);
    selectApi(api);
    setShowTemplates(false);
  };

  const saveCurrent = () => {
    if (!selectedApiId) { createApi(); return; }
    setApis((prev) =>
      prev.map((a) =>
        a.id === selectedApiId
          ? { ...a, name: name || a.name, method, url, headersText, body, authType, authToken, authHeaderName, authUsername, authPassword, authTokenUrl, authClientId, authClientSecret, proxyPath, history }
          : a
      )
    );
  };

  const deleteApi = (id: string) => {
    setApis((prev) => prev.filter((a) => a.id !== id));
    if (selectedApiId === id) {
      setPs({
        activeApi: null, apisName: "", apisMethod: "GET", apisUrl: "", apisHeadersText: "{}",
        apisBody: "", apisAuthType: "none", apisAuthToken: "", apisAuthHeaderName: "X-API-Key",
        apisAuthUsername: "", apisAuthPassword: "", apisAuthTokenUrl: "", apisAuthClientId: "",
        apisAuthClientSecret: "", apisProxyPath: "",
      });
      setUI({ apisHistory: [], apisResponse: null });
    }
  };

  const applyCurl = () => {
    if (!curlPaste.trim()) return;
    const parsed = parseCurl(curlPaste);
    if (parsed) {
      setPs({
        ...(parsed.method ? { apisMethod: parsed.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" } : {}),
        ...(parsed.url ? { apisUrl: parsed.url } : {}),
        ...(parsed.headersText ? { apisHeadersText: parsed.headersText } : {}),
        ...(parsed.body !== undefined ? { apisBody: parsed.body } : {}),
      });
    }
    setUI({ apisCurlPaste: "" });
  };

  const applyOpenapi = () => {
    if (!openapiPaste.trim()) return;
    try {
      const spec = YAML.load(openapiPaste) as Record<string, unknown>;
      const baseUrl = (spec.servers as Array<{ url: string }>)?.[0]?.url || "https://api.example.com";
      const paths = (spec.paths || {}) as Record<string, Record<string, { summary?: string }>>;
      const newApis: SavedApi[] = [];
      for (const [path, methods] of Object.entries(paths)) {
        for (const [mName, details] of Object.entries(methods)) {
          const upper = mName.toUpperCase();
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upper)) continue;
          newApis.push({
            id: generateId(), name: details.summary || `${upper} ${path}`, method: upper,
            url: `${baseUrl}${path}`, headersText: "{}", body: "", authType: "none",
            authToken: "", authHeaderName: "X-API-Key", authUsername: "", authPassword: "",
            authTokenUrl: "", authClientId: "", authClientSecret: "", proxyPath: "", history: [],
          });
        }
      }
      if (newApis.length > 0) setApis((prev) => [...prev, ...newApis]);
    } catch { /* ignore parse errors */ }
    setUI({ apisOpenapiPaste: "" });
  };

  function generateCodeVerifier(): string {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  async function generateCodeChallenge(verifier: string): Promise<string> {
    const data = new TextEncoder().encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const startOAuth2 = async () => {
    if (!authTokenUrl || !authClientId) return;
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = "http://localhost:8080/callback";
    const authorizeUrl = new URL(authTokenUrl.replace("/token", "/authorize"));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", authClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", Math.random().toString(36).slice(2));
    window.open(authorizeUrl.toString(), "_blank");
    setShowOauthDialog(true);
    setOauthCode("");
  };

  const exchangeOAuth2Code = async () => {
    if (!oauthCode.trim() || !authTokenUrl || !authClientId) return;
    setOauthLoading(true);
    try {
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code", code: oauthCode.trim(),
        redirect_uri: "http://localhost:8080/callback", client_id: authClientId,
        client_secret: authClientSecret,
      }).toString();
      const res = await httpRequest("POST", authTokenUrl, { "Content-Type": "application/x-www-form-urlencoded" }, tokenBody);
      const token = (JSON.parse(res.body) as Record<string, string>).access_token || "";
      if (token) setPs({ apisAuthToken: token });
      setShowOauthDialog(false);
      setOauthCode("");
    } catch (e) {
      notify.error("OAuth token exchange failed", getErrorMessage(e));
    } finally {
      setOauthLoading(false);
    }
  };

  const send = async () => {
    if (!url.trim()) return;
    setLoading(true);
    const start = Date.now();
    try {
      const resolvedUrl = resolveEnvVars(url);
      const resolvedBody = body ? resolveEnvVars(body) : undefined;
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of Object.entries(JSON.parse(headersText) as Record<string, string>))
          headers[k] = resolveEnvVars(v);
      } catch { /* ignore */ }
      if (authType === "bearer" && authToken) headers["Authorization"] = `Bearer ${authToken}`;
      else if (authType === "apikey" && authToken) headers[authHeaderName || "X-API-Key"] = authToken;
      else if (authType === "basic" && authUsername) headers["Authorization"] = `Basic ${btoa(`${authUsername}:${authPassword}`)}`;
      else if (authType === "oauth2" && authToken) headers["Authorization"] = `Bearer ${authToken}`;
      const res = await httpRequest(method, resolvedUrl, headers, resolvedBody);
      const entry: ApiHistoryEntry = { timestamp: Date.now(), method, url, status: res.status, duration: Date.now() - start };
      const nextHistory = [entry, ...history].slice(0, 50);
      setUI({ apisResponse: res, apisHistory: nextHistory });
      if (selectedApiId) setApis((prev) => prev.map((a) => (a.id === selectedApiId ? { ...a, history: nextHistory } : a)));
    } catch (e) {
      const msg = getErrorMessage(e);
      setUI({ apisResponse: { status: 0, headers: {}, body: `Error: ${msg}` } });
      notify.error("Request failed", msg);
    } finally {
      setLoading(false);
    }
  };

  const generateService = async () => {
    if (!selectedApiId) return;
    setGeneratingService(true);
    try {
      let tsInterface = `export type ${buildInterfaceName(name)} = unknown`;
      if (response?.body) {
        try {
          const parsed = JSON.parse(response.body) as unknown;
          tsInterface = jsonToTsInterface(buildInterfaceName(name), parsed);
        } catch { /* keep fallback */ }
      }
      const serviceContent = buildServiceFile(
        { id: selectedApiId, name, method, url, headersText, body, authType, authToken, authHeaderName, authUsername, authPassword, authTokenUrl, authClientId, authClientSecret, proxyPath, history },
        tsInterface,
        buildInterfaceName(name),
      );
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const servicePath = `projects/${settings.project}/generated/src/services/${slug}.ts`;
      await createDir(`projects/${settings.project}/generated/src/services`);
      await writeFile(servicePath, serviceContent);
      notify.success("Service generated", `Written to src/services/${slug}.ts`);
    } catch (e) {
      notify.error("Failed to generate service", getErrorMessage(e));
    } finally {
      setGeneratingService(false);
    }
  };

  const addApiKey = () => {
    if (!newKeyName.trim()) return;
    const key: ApiKey = { id: generateId(), name: newKeyName.trim(), value: newKeyValue, description: newKeyDesc };
    setApiKeys((prev) => [...prev, key]);
    setNewKeyName(""); setNewKeyValue(""); setNewKeyDesc("");
  };

  const updateApiKey = (id: string, field: keyof ApiKey, value: string) => {
    setApiKeys((prev) => prev.map((k) => (k.id === id ? { ...k, [field]: value } : k)));
  };

  const deleteApiKey = (id: string) => setApiKeys((prev) => prev.filter((k) => k.id !== id));

  // Derived proxy mappings from APIs with proxyPath set
  const proxyMappings = (() => {
    const m: Record<string, string> = {};
    for (const api of apis) {
      if (api.proxyPath?.trim() && api.url?.trim()) {
        try { const p = new URL(api.url); m[api.proxyPath] = p.origin + p.pathname; } catch { /* skip */ }
      }
    }
    return m;
  })();

  // Schema tab: TypeScript interface from last response
  const schemaContent = (() => {
    if (!response?.body) return "";
    try {
      const parsed = JSON.parse(response.body) as unknown;
      return jsonToTsInterface(buildInterfaceName(name || "Response"), parsed);
    } catch {
      return `// Response is not valid JSON — cannot infer TypeScript types`;
    }
  })();

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>

        {/* ── Sidebar ── */}
        <Allotment.Pane preferredSize={220} minSize={180}>
          <div className="h-full flex flex-col bg-card border-r border-border">

            {/* Sidebar toolbar */}
            <div className="panel-toolbar h-10 px-3 gap-2">
              <span className="text-sm font-medium">{sidebarTab === "collection" ? "APIs" : "Keys"}</span>
              <div className="flex-1" />

              {sidebarTab === "collection" && (
                <>
                  <DropdownMenu open={showTemplates} onOpenChange={setShowTemplates}>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7" title="Add from template">
                        <Database size={13} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-80">
                      {API_TEMPLATES.map((tmpl) => (
                        <DropdownMenuItem key={tmpl.name} className="flex-col items-start gap-0.5 py-2" onSelect={() => addFromTemplate(tmpl)}>
                          <div className="flex items-center gap-2 w-full">
                            <span className={[
                              "text-[10px] font-bold px-1 py-0.5 rounded",
                              tmpl.method === "GET" ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600",
                            ].join(" ")}>{tmpl.method}</span>
                            <span className="text-xs font-medium">{tmpl.name}</span>
                          </div>
                          <span className="text-[11px] text-muted-foreground pl-1">{tmpl.description}</span>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createApi} title="New API">
                    <Plus size={14} />
                  </Button>
                </>
              )}

              {sidebarTab === "keys" && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1"
                  onClick={() => syncToProject(settings.project, apiKeys, apis)}
                  title="Sync keys and proxy config to generated project"
                >
                  <RefreshCw size={11} />
                  Sync
                </Button>
              )}

              <Button
                variant={sidebarTab === "keys" ? "secondary" : "ghost"}
                size="icon"
                className="h-7 w-7"
                onClick={() => setSidebarTab(sidebarTab === "collection" ? "keys" : "collection")}
                title="Toggle Key Vault"
              >
                <Key size={13} />
              </Button>
            </div>

            {/* API list */}
            {sidebarTab === "collection" && (
              <ScrollArea className="flex-1 overflow-hidden">
                <div className="p-2 space-y-1">
                  {apis.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                      <Globe size={20} className="opacity-30" />
                      <p className="text-xs font-medium">No APIs yet</p>
                      <p className="text-[10px] opacity-60">Add an API or pick a template to get started</p>
                    </div>
                  )}
                  {apis.map((api) => (
                    <div
                      key={api.id}
                      className={[
                        "group flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer transition-colors",
                        selectedApiId === api.id ? "bg-accent text-accent-foreground" : "hover:bg-muted text-muted-foreground",
                      ].join(" ")}
                      onClick={() => selectApi(api)}
                    >
                      <span className={[
                        "text-[10px] font-bold px-1 py-0.5 rounded shrink-0",
                        api.method === "GET" ? "bg-green-500/10 text-green-600"
                          : api.method === "POST" ? "bg-blue-500/10 text-blue-600"
                          : api.method === "DELETE" ? "bg-red-500/10 text-red-600"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}>{api.method}</span>
                      <span className="flex-1 truncate">{api.name}</span>
                      <Button variant="ghost" size="icon" className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
                        onClick={(e) => { e.stopPropagation(); deleteApi(api.id); }}>
                        <Trash2 size={10} className="text-red-500" />
                      </Button>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}

            {/* Key Vault */}
            {sidebarTab === "keys" && (
              <div className="flex-1 flex flex-col overflow-hidden">
                <ScrollArea className="flex-1 overflow-hidden">
                  <div className="p-3 space-y-3">
                    {apiKeys.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-6 gap-2 text-muted-foreground text-center">
                        <Key size={20} className="opacity-30" />
                        <p className="text-xs font-medium">No API keys yet</p>
                        <p className="text-[10px] opacity-60 leading-relaxed">Add keys here to sync them as VITE_* env vars to your generated project</p>
                      </div>
                    )}
                    {apiKeys.map((k) => (
                      <div key={k.id} className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-wide">VITE_</span>
                          <Input
                            value={k.name}
                            onChange={(e) => updateApiKey(k.id, "name", e.target.value.toUpperCase().replace(/\W+/g, "_"))}
                            className="h-6 text-xs font-mono flex-1 uppercase"
                            placeholder="KEY_NAME"
                          />
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => deleteApiKey(k.id)}>
                            <X size={10} className="text-red-500" />
                          </Button>
                        </div>
                        <Input
                          type="password"
                          value={k.value}
                          onChange={(e) => updateApiKey(k.id, "value", e.target.value)}
                          className="h-6 text-xs"
                          placeholder="Key value"
                        />
                        {k.description && (
                          <p className="text-[10px] text-muted-foreground">{k.description}</p>
                        )}
                      </div>
                    ))}

                    {/* Add new key */}
                    <div className="border-t border-border pt-3 space-y-1.5">
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] font-mono text-muted-foreground">VITE_</span>
                        <Input
                          value={newKeyName}
                          onChange={(e) => setNewKeyName(e.target.value.toUpperCase().replace(/\W+/g, "_"))}
                          className="h-6 text-xs font-mono flex-1 uppercase"
                          placeholder="KEY_NAME"
                          onKeyDown={(e) => { if (e.key === "Enter") addApiKey(); }}
                        />
                      </div>
                      <Input
                        type="password"
                        value={newKeyValue}
                        onChange={(e) => setNewKeyValue(e.target.value)}
                        className="h-6 text-xs"
                        placeholder="Key value"
                        onKeyDown={(e) => { if (e.key === "Enter") addApiKey(); }}
                      />
                      <Input
                        value={newKeyDesc}
                        onChange={(e) => setNewKeyDesc(e.target.value)}
                        className="h-6 text-xs text-muted-foreground"
                        placeholder="Description (optional)"
                      />
                      <Button size="sm" className="h-7 w-full text-xs gap-1" onClick={addApiKey} disabled={!newKeyName.trim()}>
                        <Plus size={12} />
                        Add Key
                      </Button>
                    </div>

                    {/* Proxy mappings preview */}
                    {Object.keys(proxyMappings).length > 0 && (
                      <div className="border-t border-border pt-3 space-y-1.5">
                        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Proxy Mappings</p>
                        {Object.entries(proxyMappings).map(([prefix, target]) => (
                          <div key={prefix} className="text-[10px] font-mono text-muted-foreground">
                            <span className="text-foreground">{prefix}</span>
                            <span className="mx-1">→</span>
                            <span className="truncate">{target}</span>
                          </div>
                        ))}
                        <p className="text-[10px] text-muted-foreground">Derived from APIs with Proxy Path set. Click Sync to write to vite.config.ts</p>
                      </div>
                    )}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>
        </Allotment.Pane>

        {/* ── Main split (Request | Response) ── */}
        <Allotment.Pane>
          <Allotment>

            {/* Request pane */}
            <Allotment.Pane minSize={320}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">Request</span>
                  <div className="flex-1" />
                  {selectedApiId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1"
                      onClick={generateService}
                      disabled={generatingService}
                      title="Generate a typed TanStack Query service file in src/services/"
                    >
                      <Plug size={11} />
                      {generatingService ? "Generating…" : "Service"}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={saveCurrent}>
                    <Save size={12} />
                    Save
                  </Button>
                </div>

                <ScrollArea className="flex-1 overflow-hidden">
                  <div className="p-3 space-y-3">
                    <Input
                      placeholder="API Name"
                      value={name}
                      onChange={(e) => setPs({ apisName: e.target.value })}
                      className="h-8 text-sm"
                    />

                    <div className="flex gap-2">
                      <Select value={method} onValueChange={(v) => setPs({ apisMethod: v as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" })}>
                        <SelectTrigger className="w-[100px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" side="bottom">
                          {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                            <SelectItem key={m} value={m}>{m}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="https://api.example.com/endpoint"
                        value={url}
                        onChange={(e) => setPs({ apisUrl: e.target.value })}
                      />
                      <Button onClick={send} disabled={loading}>
                        <Send size={14} />
                      </Button>
                    </div>

                    {/* Proxy Path */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                        <Plug size={11} />
                        Proxy Path
                        <span className="text-[10px] normal-case font-normal text-muted-foreground/60">(routes /path/* → API host in dev)</span>
                      </label>
                      <Input
                        placeholder="/api/weather"
                        value={proxyPath}
                        onChange={(e) => setPs({ apisProxyPath: e.target.value })}
                        className="h-7 text-xs font-mono"
                      />
                    </div>

                    {/* cURL Paste */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Paste cURL</label>
                      <div className="flex gap-2">
                        <Input
                          value={curlPaste}
                          onChange={(e) => setUI({ apisCurlPaste: e.target.value })}
                          placeholder="curl -X GET https://api.example.com"
                          className="h-7 text-xs"
                        />
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyCurl}>Parse</Button>
                      </div>
                    </div>

                    {/* OpenAPI Import */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Import OpenAPI (YAML/JSON)</label>
                      <div className="flex gap-2">
                        <Input
                          value={openapiPaste}
                          onChange={(e) => setUI({ apisOpenapiPaste: e.target.value })}
                          placeholder="Paste OpenAPI spec..."
                          className="h-7 text-xs"
                        />
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyOpenapi}>Import</Button>
                      </div>
                    </div>

                    {/* Auth */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">Authentication</label>
                      <div className="flex gap-2 flex-wrap">
                        <Select value={authType} onValueChange={(v) => setPs({ apisAuthType: v as "none" | "bearer" | "apikey" | "basic" | "oauth2" })}>
                          <SelectTrigger className="w-[120px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent position="popper" side="bottom">
                            <SelectItem value="none">None</SelectItem>
                            <SelectItem value="bearer">Bearer</SelectItem>
                            <SelectItem value="apikey">API Key</SelectItem>
                            <SelectItem value="basic">Basic</SelectItem>
                            <SelectItem value="oauth2">OAuth2</SelectItem>
                          </SelectContent>
                        </Select>
                        {authType === "bearer" && (
                          <Input type="password" placeholder="Bearer token" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
                        )}
                        {authType === "apikey" && (
                          <>
                            <Input placeholder="Header name" value={authHeaderName} onChange={(e) => setPs({ apisAuthHeaderName: e.target.value })} className="h-8 text-xs w-[140px]" />
                            <Input type="password" placeholder="API Key" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
                          </>
                        )}
                        {authType === "oauth2" && (
                          <Input type="password" placeholder="Access token" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
                        )}
                      </div>
                      {authType === "basic" && (
                        <div className="flex gap-2">
                          <Input placeholder="Username" value={authUsername} onChange={(e) => setPs({ apisAuthUsername: e.target.value })} className="h-8 text-xs" />
                          <Input type="password" placeholder="Password" value={authPassword} onChange={(e) => setPs({ apisAuthPassword: e.target.value })} className="h-8 text-xs" />
                        </div>
                      )}
                      {authType === "oauth2" && (
                        <div className="space-y-2">
                          <Input placeholder="Token endpoint URL" value={authTokenUrl} onChange={(e) => setPs({ apisAuthTokenUrl: e.target.value })} className="h-8 text-xs" />
                          <div className="flex gap-2">
                            <Input placeholder="Client ID" value={authClientId} onChange={(e) => setPs({ apisAuthClientId: e.target.value })} className="h-8 text-xs" />
                            <Input type="password" placeholder="Client Secret" value={authClientSecret} onChange={(e) => setPs({ apisAuthClientSecret: e.target.value })} className="h-8 text-xs" />
                          </div>
                          <Input type="password" placeholder="Access token (auto-filled after auth)" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs" />
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={startOAuth2} disabled={!authTokenUrl || !authClientId}>Authorize</Button>
                        </div>
                      )}
                    </div>

                    {/* Headers */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Headers (JSON)</label>
                      <div className="h-32 border rounded overflow-hidden">
                        <CodeMirrorEditor value={headersText} onChange={(v) => setPs({ apisHeadersText: v })} mode="json" />
                      </div>
                    </div>

                    {/* Body */}
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">Body</label>
                      <Textarea
                        value={body}
                        onChange={(e) => setPs({ apisBody: e.target.value })}
                        placeholder="Request body... (use {{VAR_NAME}} for env vars)"
                        className="min-h-[120px] text-sm font-mono"
                      />
                    </div>

                    {/* Env Vars */}
                    <div className="space-y-2">
                      <label className="text-xs font-medium text-muted-foreground">
                        Environment Variables
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground/60">use {"{{KEY}}"} in URLs/body</span>
                      </label>
                      {Object.entries(envVars).map(([key, value]) => (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded w-28 truncate">{key}</span>
                          <Input value={value} onChange={(e) => setUI({ apisEnvVars: { ...envVars, [key]: e.target.value } })} className="h-7 text-xs flex-1" />
                          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                            const next = { ...envVars }; delete next[key]; setUI({ apisEnvVars: next });
                          }}><Trash2 size={10} /></Button>
                        </div>
                      ))}
                      <div className="flex gap-2">
                        <Input placeholder="Key (e.g. BASE_URL)" value={newEnvKey} onChange={(e) => setUI({ apisNewEnvKey: e.target.value })} className="h-7 text-xs" />
                        <Input placeholder="Value" value={newEnvValue} onChange={(e) => setUI({ apisNewEnvValue: e.target.value })} className="h-7 text-xs flex-1" />
                        <Button size="sm" className="h-7" onClick={() => {
                          if (!newEnvKey.trim()) return;
                          setUI({ apisEnvVars: { ...envVars, [newEnvKey.trim()]: newEnvValue }, apisNewEnvKey: "", apisNewEnvValue: "" });
                        }} disabled={!newEnvKey.trim()}><Plus size={14} /></Button>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
            </Allotment.Pane>

            {/* Response pane */}
            <Allotment.Pane minSize={320}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">Response</span>
                  {response && (
                    <span className={[
                      "text-xs px-1.5 py-0.5 rounded font-medium",
                      response.status >= 200 && response.status < 300 ? "bg-green-500/10 text-green-600"
                        : response.status >= 400 ? "bg-red-500/10 text-red-600"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}>{response.status}</span>
                  )}
                  <div className="flex-1" />
                  {response && (
                    <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
                      onClick={() => navigator.clipboard.writeText(response.body)}>
                      <Copy size={12} />Copy
                    </Button>
                  )}
                </div>

                <Tabs defaultValue="body" className="flex-1 flex flex-col overflow-hidden">
                  <TabsList variant="line" className="h-7">
                    <TabsTrigger value="body" className="text-[11px]">Body</TabsTrigger>
                    <TabsTrigger value="schema" className="text-[11px]">TypeScript</TabsTrigger>
                    <TabsTrigger value="headers" className="text-[11px]">Headers</TabsTrigger>
                    <TabsTrigger value="history" className="text-[11px]">History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="body" className="flex-1 overflow-hidden mt-0">
                    {response ? (
                      <CodeMirrorEditor
                        value={(() => { try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; } })()}
                        mode={(() => { try { JSON.parse(response.body); return "json"; } catch { return "yaml"; } })()}
                        readOnly
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        Send a request to see the response
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="schema" className="flex-1 overflow-hidden mt-0">
                    {response ? (
                      <div className="relative h-full">
                        <Button
                          variant="ghost" size="sm"
                          className="absolute top-1 right-1 z-10 gap-1 text-xs"
                          onClick={() => navigator.clipboard.writeText(schemaContent)}
                        >
                          <Copy size={12} />Copy
                        </Button>
                        <CodeMirrorEditor value={schemaContent} mode="javascript" readOnly />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        Send a request to infer TypeScript types
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="headers" className="flex-1 overflow-hidden mt-0">
                    {response ? (
                      <CodeMirrorEditor value={JSON.stringify(response.headers, null, 2)} mode="json" readOnly />
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                        <Terminal size={24} className="opacity-25" />
                        <p className="text-sm font-medium">No response yet</p>
                        <p className="text-xs opacity-60">Send a request to see the response</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="history" className="flex-1 mt-0">
                    <ScrollArea className="h-full overflow-hidden">
                      <div className="p-3">
                        {history.length > 0 ? (
                          <div className="space-y-1">
                            {history.map((h, i) => (
                              <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors">
                                <span className={[
                                  "font-bold px-1 py-0.5 rounded",
                                  h.status >= 200 && h.status < 300 ? "bg-green-500/10 text-green-600"
                                    : h.status >= 400 ? "bg-red-500/10 text-red-600"
                                    : "bg-muted text-muted-foreground",
                                ].join(" ")}>{h.status}</span>
                                <span className="font-medium w-12">{h.method}</span>
                                <span className="flex-1 truncate text-muted-foreground">{h.url}</span>
                                <span className="text-muted-foreground shrink-0">{h.duration}ms · {new Date(h.timestamp).toLocaleTimeString()}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center text-muted-foreground text-sm">No request history</div>
                        )}
                      </div>
                    </ScrollArea>
                  </TabsContent>
                </Tabs>
              </div>
            </Allotment.Pane>

          </Allotment>
        </Allotment.Pane>
      </Allotment>

      {/* OAuth2 dialog */}
      {showOauthDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-lg shadow-lg p-4 w-[400px] space-y-3">
            <h3 className="text-sm font-medium">OAuth2 Authorization Code</h3>
            <p className="text-xs text-muted-foreground">
              After authorizing in your browser, paste the authorization code from the redirect URL.
              The redirect URL will look like: http://localhost:8080/callback?code=AUTH_CODE
            </p>
            <Input
              placeholder="Paste authorization code here..."
              value={oauthCode}
              onChange={(e) => setOauthCode(e.target.value)}
              className="h-8 text-xs font-mono"
              onKeyDown={(e) => { if (e.key === "Enter") exchangeOAuth2Code(); }}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowOauthDialog(false)}>Cancel</Button>
              <Button size="sm" className="h-7 text-xs" onClick={exchangeOAuth2Code} disabled={!oauthCode.trim() || oauthLoading}>
                {oauthLoading ? "Exchanging..." : "Exchange Code"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

