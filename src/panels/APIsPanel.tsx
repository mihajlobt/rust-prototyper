import { useState, useEffect, useCallback } from "react";
import { Allotment } from "allotment";
import { Send, Plus, Trash2, Save, Copy } from "lucide-react";
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
import { httpRequest, readFile, writeFile, createDir } from "@/lib/ipc";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore, type ApiHistoryEntry } from "@/stores/uiStore";
import { notify } from "@/hooks/useToast";
import YAML from "js-yaml";

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
  history: ApiHistoryEntry[];
}

function getApisPath(project: string) {
  return `projects/${project}/apis/apis.json`;
}

function getEnvPath(project: string) {
  return `projects/${project}/apis/env.json`;
}

async function loadEnvVars(project: string): Promise<Record<string, string>> {
  try {
    const data = await readFile(getEnvPath(project));
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveEnvVars(project: string, envVars: Record<string, string>) {
  try {
    const path = getEnvPath(project);
    await createDir(path.replace("/env.json", ""));
    await writeFile(path, JSON.stringify(envVars, null, 2));
  } catch (e) {
    notify.error("Failed to save environment variables", e instanceof Error ? e.message : String(e));
  }
}

async function loadApis(project: string): Promise<SavedApi[]> {
  try {
    const data = await readFile(getApisPath(project));
    return JSON.parse(data);
  } catch {
    return [];
  }
}

async function saveApis(project: string, apis: SavedApi[]) {
  try {
    const path = getApisPath(project);
    await createDir(path.replace("/apis.json", ""));
    await writeFile(path, JSON.stringify(apis, null, 2));
  } catch (e) {
    notify.error("Failed to save APIs", e instanceof Error ? e.message : String(e));
  }
}

function generateId() {
  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseCurl(input: string): Partial<SavedApi> | null {
  // Improved cURL parser handling multiline, nested quotes, etc.
  const normalized = input.replace(/\\\n/g, " ").replace(/\n/g, " ").trim();
  const methodMatch = normalized.match(/curl\s+(?:-X\s+|--request\s+)(\w+)\s+['"]?(https?:\/\/[^\s'"]+)['"]?/i)
    || normalized.match(/curl\s+['"]?(https?:\/\/[^\s'"]+)['"]?/i);
  if (!methodMatch) return null;
  const url = methodMatch[2] || methodMatch[1];
  const method = methodMatch[1] && /^https?:\/\//i.test(methodMatch[1]) ? "GET" : (methodMatch[1] || "GET").toUpperCase();
  const headers: Record<string, string> = {};
  const headerMatches = normalized.matchAll(/(?:-H|--header)\s+['"]([^'"]+?)['"]/g);
  for (const m of headerMatches) {
    const colonIdx = m[1].indexOf(":");
    if (colonIdx > 0) {
      headers[m[1].slice(0, colonIdx).trim()] = m[1].slice(colonIdx + 1).trim();
    }
  }
  const bodyMatch = normalized.match(/(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]\s*(?:-H|-X|curl|$)/i)
    || normalized.match(/(?:-d|--data|--data-raw)\s+['"]([\s\S]*?)['"]\s*$/i);
  const body = bodyMatch ? bodyMatch[1] : "";
  return { url, method, headersText: JSON.stringify(headers, null, 2), body };
}

export function APIsPanel() {
  const { settings } = useAppStore();
  const { ps, setPs, openApi } = useProjectSettingsStore();
  const selectedApiId = ps.activeApi;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("apis", 2);
  const [apis, setApis] = useState<SavedApi[]>([]);

  // Persistent editor state (per-project)
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

  // Ephemeral state (session-only)
  const response = useUIStore((s) => s.apisResponse);
  const history = useUIStore((s) => s.apisHistory);
  const envVars = useUIStore((s) => s.apisEnvVars);
  const newEnvKey = useUIStore((s) => s.apisNewEnvKey);
  const newEnvValue = useUIStore((s) => s.apisNewEnvValue);
  const curlPaste = useUIStore((s) => s.apisCurlPaste);
  const openapiPaste = useUIStore((s) => s.apisOpenapiPaste);
  const setUI = useUIStore.setState;

  // Ephemeral UI state (not persisted)
  const [oauthCode, setOauthCode] = useState("");
  const [showOauthDialog, setShowOauthDialog] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  // Load from FS on project change
  useEffect(() => {
    let cancelled = false;
    loadApis(settings.project).then((data) => {
      if (!cancelled) setApis(data);
    });
    loadEnvVars(settings.project).then((data) => {
      if (!cancelled) setUI({ apisEnvVars: data });
    });
    return () => { cancelled = true; };
  }, [settings.project, setUI]);

  // Save to FS on change
  useEffect(() => {
    saveApis(settings.project, apis);
  }, [apis, settings.project]);

  // Save env vars to FS on change
  useEffect(() => {
    saveEnvVars(settings.project, envVars);
  }, [envVars, settings.project]);

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
    });
    setUI({ apisHistory: api.history || [], apisResponse: null, apisCurlPaste: "", apisOpenapiPaste: "" });
  }, [openApi, setPs, setUI]);

  function resolveEnvVars(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => envVars[key] ?? `{{${key}}}`);
  }

  const createApi = () => {
    const api: SavedApi = {
      id: generateId(),
      name: "New API",
      method: "GET",
      url: "",
      headersText: "{}",
      body: "",
      authType: "none",
      authToken: "",
      authHeaderName: "X-API-Key",
      authUsername: "",
      authPassword: "",
      authTokenUrl: "",
      authClientId: "",
      authClientSecret: "",
      history: [],
    };
    setApis((prev) => [...prev, api]);
    selectApi(api);
  };

  const saveCurrent = () => {
    if (!selectedApiId) {
      createApi();
      return;
    }
    setApis((prev) =>
      prev.map((a) =>
        a.id === selectedApiId
          ? { ...a, name: name || a.name, method, url, headersText, body, authType, authToken, authHeaderName, authUsername, authPassword, authTokenUrl, authClientId, authClientSecret, history }
          : a
      )
    );
  };

  const deleteApi = (id: string) => {
    setApis((prev) => prev.filter((a) => a.id !== id));
    if (selectedApiId === id) {
      setPs({
        activeApi: null,
        apisName: "", apisMethod: "GET", apisUrl: "", apisHeadersText: "{}",
        apisBody: "", apisAuthType: "none", apisAuthToken: "",
        apisAuthHeaderName: "X-API-Key", apisAuthUsername: "", apisAuthPassword: "",
        apisAuthTokenUrl: "", apisAuthClientId: "", apisAuthClientSecret: "",
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
      const baseUrl =
        (spec.servers as Array<{ url: string }>)?.[0]?.url || "https://api.example.com";
      const paths = (spec.paths || {}) as Record<
        string,
        Record<string, { summary?: string; description?: string; parameters?: unknown[]; requestBody?: unknown }>
      >;
      const newApis: SavedApi[] = [];
      for (const [path, methods] of Object.entries(paths)) {
        for (const [methodName, details] of Object.entries(methods)) {
          const upperMethod = methodName.toUpperCase();
          if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(upperMethod)) continue;
          newApis.push({
            id: generateId(),
            name: details.summary || `${upperMethod} ${path}`,
            method: upperMethod,
            url: `${baseUrl}${path}`,
            headersText: "{}",
            body: "",
            authType: "none",
            authToken: "",
            authHeaderName: "X-API-Key",
            authUsername: "",
            authPassword: "",
            authTokenUrl: "",
            authClientId: "",
            authClientSecret: "",
            history: [],
          });
        }
      }
      if (newApis.length > 0) {
        setApis((prev) => [...prev, ...newApis]);
      }
    } catch {
      // ignore parse errors
    }
    setUI({ apisOpenapiPaste: "" });
  };

  function generateCodeVerifier(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function generateCodeChallenge(verifier: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const startOAuth2 = async () => {
    if (!authTokenUrl || !authClientId) return;
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = "http://localhost:8080/callback";
    const state = Math.random().toString(36).slice(2);
    const authorizeUrl = new URL(authTokenUrl.replace("/token", "/authorize"));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", authClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", state);
    window.open(authorizeUrl.toString(), "_blank");
    setShowOauthDialog(true);
    setOauthCode("");
  };

  const exchangeOAuth2Code = async () => {
    if (!oauthCode.trim() || !authTokenUrl || !authClientId) return;
    setOauthLoading(true);
    try {
      const redirectUri = "http://localhost:8080/callback";
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code: oauthCode.trim(),
        redirect_uri: redirectUri,
        client_id: authClientId,
        client_secret: authClientSecret,
      }).toString();
      const res = await httpRequest("POST", authTokenUrl, {
        "Content-Type": "application/x-www-form-urlencoded",
      }, tokenBody);
      const data = JSON.parse(res.body);
      const token = data.access_token || data.token || "";
      if (token) {
        setPs({ apisAuthToken: token });
      }
      setShowOauthDialog(false);
      setOauthCode("");
    } catch (e) {
      notify.error("OAuth token exchange failed", e instanceof Error ? e.message : String(e));
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
        const parsedHeaders = JSON.parse(headersText);
        for (const [key, value] of Object.entries(parsedHeaders)) {
          headers[key] = resolveEnvVars(value as string);
        }
      } catch {
        // ignore invalid JSON
      }
      if (authType === "bearer" && authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      } else if (authType === "apikey" && authToken) {
        headers[authHeaderName || "X-API-Key"] = authToken;
      } else if (authType === "basic" && authUsername) {
        const encoded = btoa(`${authUsername}:${authPassword}`);
        headers["Authorization"] = `Basic ${encoded}`;
      } else if (authType === "oauth2" && authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const res = await httpRequest(method, resolvedUrl, headers, resolvedBody || undefined);
      const entry: ApiHistoryEntry = {
        timestamp: Date.now(),
        method,
        url,
        status: res.status,
        duration: Date.now() - start,
      };
      const nextHistory = [entry, ...history].slice(0, 50);
      setUI({ apisResponse: res, apisHistory: nextHistory });
      if (selectedApiId) {
        setApis((prev) =>
          prev.map((a) => (a.id === selectedApiId ? { ...a, history: nextHistory } : a))
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setUI({
        apisResponse: {
          status: 0,
          headers: {},
          body: `Error: ${msg}`,
        },
      });
      notify.error("Request failed", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        {/* APIs Sidebar */}
        <Allotment.Pane preferredSize={220} minSize={180}>
          <div className="h-full flex flex-col bg-card border-r border-border">
            <div className="panel-toolbar h-10 px-3 gap-2">
              <span className="text-sm font-medium">APIs</span>
              <div className="flex-1" />
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={createApi}>
                <Plus size={14} />
              </Button>
            </div>
            <div className="flex-1 overflow-auto p-2 space-y-1">
              {apis.length === 0 && (
                <div className="text-xs text-muted-foreground px-1">No saved APIs</div>
              )}
              {apis.map((api) => (
                <div
                  key={api.id}
                  className={[
                    "group flex items-center gap-2 px-2 py-1.5 text-xs rounded cursor-pointer transition-colors",
                    selectedApiId === api.id
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted text-muted-foreground",
                  ].join(" ")}
                  onClick={() => selectApi(api)}
                >
                  <span
                    className={[
                      "text-[10px] font-bold px-1 py-0.5 rounded",
                      api.method === "GET"
                        ? "bg-green-500/10 text-green-600"
                        : api.method === "POST"
                        ? "bg-blue-500/10 text-blue-600"
                        : api.method === "DELETE"
                        ? "bg-red-500/10 text-red-600"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {api.method}
                  </span>
                  <span className="flex-1 truncate">{api.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteApi(api.id);
                    }}
                  >
                    <Trash2 size={10} className="text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </Allotment.Pane>

        {/* Main */}
        <Allotment.Pane>
          <Allotment>
            {/* Request */}
            <Allotment.Pane minSize={320}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">Request</span>
                  <div className="flex-1" />
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={saveCurrent}>
                    <Save size={12} />
                    Save
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-3 space-y-3">
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
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
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
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyCurl}>
                        Parse
                      </Button>
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
                      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={applyOpenapi}>
                        Import
                      </Button>
                    </div>
                  </div>

                  {/* Auth */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Authentication</label>
                    <div className="flex gap-2">
                      <Select
                        value={authType}
                        onValueChange={(v) => setPs({ apisAuthType: v as "none" | "bearer" | "apikey" | "basic" | "oauth2" })}
                      >
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
                        <Input type="password" placeholder="Bearer token" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs" />
                      )}
                      {authType === "apikey" && (
                        <div className="flex gap-2">
                          <Input placeholder="Header name" value={authHeaderName} onChange={(e) => setPs({ apisAuthHeaderName: e.target.value })} className="h-8 text-xs w-[140px]" />
                          <Input type="password" placeholder="API Key" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs" />
                        </div>
                      )}
                      {authType === "oauth2" && (
                        <Input type="password" placeholder="Access token" value={authToken} onChange={(e) => setPs({ apisAuthToken: e.target.value })} className="h-8 text-xs" />
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
                        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={startOAuth2} disabled={!authTokenUrl || !authClientId}>
                          Authorize
                        </Button>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Headers (JSON)</label>
                    <div className="h-32 border rounded overflow-hidden">
                      <CodeMirrorEditor value={headersText} onChange={(v) => setPs({ apisHeadersText: v })} mode="json" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Body</label>
                    <Textarea
                      value={body}
                      onChange={(e) => setPs({ apisBody: e.target.value })}
                      placeholder="Request body... (use {{VAR_NAME}} for env vars)"
                      className="min-h-[120px] text-sm font-mono"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-muted-foreground">Environment Variables</label>
                    {Object.entries(envVars).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded w-28 truncate">{key}</span>
                        <Input
                          value={value}
                          onChange={(e) => setUI({ apisEnvVars: { ...envVars, [key]: e.target.value } })}
                          className="h-7 text-xs flex-1"
                        />
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => {
                          const next = { ...envVars };
                          delete next[key];
                          setUI({ apisEnvVars: next });
                        }}>
                          <Trash2 size={10} />
                        </Button>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <Input
                        placeholder="Key (e.g. BASE_URL)"
                        value={newEnvKey}
                        onChange={(e) => setUI({ apisNewEnvKey: e.target.value })}
                        className="h-7 text-xs"
                      />
                      <Input
                        placeholder="Value"
                        value={newEnvValue}
                        onChange={(e) => setUI({ apisNewEnvValue: e.target.value })}
                        className="h-7 text-xs flex-1"
                      />
                      <Button size="sm" className="h-7" onClick={() => {
                        if (!newEnvKey.trim()) return;
                        setUI({
                          apisEnvVars: { ...envVars, [newEnvKey.trim()]: newEnvValue },
                          apisNewEnvKey: "",
                          apisNewEnvValue: "",
                        });
                      }} disabled={!newEnvKey.trim()}>
                        <Plus size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            {/* Response */}
            <Allotment.Pane minSize={320}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">Response</span>
                  {response && (
                    <span
                      className={[
                        "text-xs px-1.5 py-0.5 rounded font-medium",
                        response.status >= 200 && response.status < 300
                          ? "bg-green-500/10 text-green-600"
                          : response.status >= 400
                          ? "bg-red-500/10 text-red-600"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}
                    >
                      {response.status}
                    </span>
                  )}
                </div>
                <Tabs defaultValue="body" className="flex-1 flex flex-col overflow-hidden">
                  <TabsList variant="line" className="h-7">
                    <TabsTrigger value="body" className="text-[11px]">Body</TabsTrigger>
                    <TabsTrigger value="schema" className="text-[11px]">Schema</TabsTrigger>
                    <TabsTrigger value="headers" className="text-[11px]">Headers</TabsTrigger>
                    <TabsTrigger value="history" className="text-[11px]">History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="body" className="flex-1 overflow-hidden mt-0">
                    {response ? (
                      <div className="relative h-full">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-1 right-1 z-10 gap-1 text-xs"
                          onClick={() => navigator.clipboard.writeText(response.body)}
                        >
                          <Copy size={12} />
                          Copy
                        </Button>
                        <CodeMirrorEditor value={response.body} mode={(() => { try { JSON.parse(response.body); return "json"; } catch { return "yaml"; } })()} readOnly />
                      </div>
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
                          variant="ghost"
                          size="sm"
                          className="absolute top-1 right-1 z-10 gap-1 text-xs"
                          onClick={() => navigator.clipboard.writeText(response.body)}
                        >
                          <Copy size={12} />
                          Copy
                        </Button>
                        <CodeMirrorEditor value={response.body} mode={(() => { try { JSON.parse(response.body); return "json"; } catch { return "yaml"; } })()} readOnly />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        Send a request to see the schema
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="headers" className="flex-1 overflow-hidden mt-0">
                    {response ? (
                      <div className="h-full">
                        <CodeMirrorEditor value={JSON.stringify(response.headers, null, 2)} mode="json" readOnly />
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        No response yet
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="history" className="flex-1 overflow-auto p-3 mt-0">
                    {history.length > 0 ? (
                      <div className="space-y-1">
                        {history.map((h, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors"
                          >
                            <span
                              className={[
                                "font-bold px-1 py-0.5 rounded",
                                h.status >= 200 && h.status < 300
                                  ? "bg-green-500/10 text-green-600"
                                  : h.status >= 400
                                  ? "bg-red-500/10 text-red-600"
                                  : "bg-muted text-muted-foreground",
                              ].join(" ")}
                            >
                              {h.status}
                            </span>
                            <span className="font-medium w-12">{h.method}</span>
                            <span className="flex-1 truncate text-muted-foreground">{h.url}</span>
                            <span className="text-muted-foreground">
                              {h.duration}ms · {new Date(h.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        No request history
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>

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
              onKeyDown={(e) => {
                if (e.key === "Enter") exchangeOAuth2Code();
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowOauthDialog(false)}>
                Cancel
              </Button>
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
