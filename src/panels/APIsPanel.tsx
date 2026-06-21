import { useState, useEffect, useCallback, useRef } from "react";
import { Allotment } from "allotment";
import {
  Plus, Trash2, RefreshCw, Database, Key, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { httpRequest, getErrorMessage, createDir, writeFile } from "@/lib/ipc";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore, type ApiHistoryEntry } from "@/stores/uiStore";
import { notify } from "@/hooks/useToast";
import YAML from "js-yaml";

import {
  loadApis, saveApis, loadApiKeys, saveApiKeys, loadEnvVars, saveEnvVars,
  generateId, parseCurl, jsonToTsInterface, buildInterfaceName, syncToProject, buildServiceFile,
} from "./apis/utils";
import { API_TEMPLATES } from "./apis/templates";
import { ApiKeysSection } from "./apis/ApiKeysSection";
import { RequestForm } from "./apis/RequestForm";
import { ResponseViewer } from "./apis/ResponseViewer";
import type { ApiKey, SavedApi } from "./apis/types";
import { confirm } from "@tauri-apps/plugin-dialog";

// Re-export public types for any external consumers
export type { ApiKey, SavedApi } from "./apis/types";
export { API_TEMPLATES } from "./apis/templates";

export function APIsPanel() {
  const { settings } = useAppStore();
  const { ps, setProjectSettings, openApi } = useProjectSettingsStore();
  const selectedApiId = ps.activeApi;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("apis", 2);

  const [apis, setApis] = useState<SavedApi[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const sidebarTab = ps.apisSidebarTab;
  const [showTemplates, setShowTemplates] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyValue, setNewKeyValue] = useState("");
  const [newKeyDesc, setNewKeyDesc] = useState("");
  const [generatingService, setGeneratingService] = useState(false);

  // Ephemeral response/history state
  const response = useUIStore((s) => s.apisResponse);
  const history = useUIStore((s) => s.apisHistory);
  const envVars = useUIStore((s) => s.apisEnvVars);
  const setUI = useUIStore.setState;

  const [oauthCode, setOauthCode] = useState("");
  const [showOauthDialog, setShowOauthDialog] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  // Tracks the project whose apis/envVars/apiKeys have finished loading from disk.
  // Save effects skip while this differs from settings.project so a project switch
  // can't write the previous project's data into the new project's files before the
  // async load resolves.
  const loadedProjectRef = useRef<string | null>(null);

  // Load from FS on project change
  useEffect(() => {
    loadedProjectRef.current = null;
    let cancelled = false;
    Promise.all([
      loadApis(settings.project),
      loadEnvVars(settings.project),
      loadApiKeys(settings.project),
    ]).then(([apisData, envData, keysData]) => {
      if (cancelled) return;
      setApis(apisData);
      setUI({ apisEnvVars: envData });
      setApiKeys(keysData);
      loadedProjectRef.current = settings.project;
    });
    return () => { cancelled = true; };
  }, [settings.project, setUI]);

  useEffect(() => {
    if (loadedProjectRef.current !== settings.project) return;
    saveApis(settings.project, apis);
  }, [apis, settings.project]);
  useEffect(() => {
    if (loadedProjectRef.current !== settings.project) return;
    saveEnvVars(settings.project, envVars);
  }, [envVars, settings.project]);
  useEffect(() => {
    if (loadedProjectRef.current !== settings.project) return;
    saveApiKeys(settings.project, apiKeys);
  }, [apiKeys, settings.project]);

  const selectApi = useCallback((api: SavedApi) => {
    openApi(api.id);
    setProjectSettings({
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
  }, [openApi, setProjectSettings, setUI]);

  function resolveEnvVars(text: string): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_, key) => useUIStore.getState().apisEnvVars[key] ?? `{{${key}}}`);
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
          ? {
              ...a,
              name: ps.apisName || a.name,
              method: ps.apisMethod,
              url: ps.apisUrl,
              headersText: ps.apisHeadersText,
              body: ps.apisBody,
              authType: ps.apisAuthType,
              authToken: ps.apisAuthToken,
              authHeaderName: ps.apisAuthHeaderName,
              authUsername: ps.apisAuthUsername,
              authPassword: ps.apisAuthPassword,
              authTokenUrl: ps.apisAuthTokenUrl,
              authClientId: ps.apisAuthClientId,
              authClientSecret: ps.apisAuthClientSecret,
              proxyPath: ps.apisProxyPath,
              history,
            }
          : a
      )
    );
  };

  const deleteApi = async (id: string) => {
    const name = apis.find((a) => a.id === id)?.name ?? "this API";
    if (!(await confirm(`Delete "${name}"?`, { title: "Delete API", kind: "warning" }))) return;
    setApis((prev) => prev.filter((a) => a.id !== id));
    if (selectedApiId === id) {
      setProjectSettings({
        activeApi: null, apisName: "", apisMethod: "GET", apisUrl: "", apisHeadersText: "{}",
        apisBody: "", apisAuthType: "none", apisAuthToken: "", apisAuthHeaderName: "X-API-Key",
        apisAuthUsername: "", apisAuthPassword: "", apisAuthTokenUrl: "", apisAuthClientId: "",
        apisAuthClientSecret: "", apisProxyPath: "",
      });
      setUI({ apisHistory: [], apisResponse: null });
    }
  };

  const applyCurl = () => {
    const curlPaste = useUIStore.getState().apisCurlPaste;
    if (!curlPaste.trim()) return;
    const parsed = parseCurl(curlPaste);
    if (parsed) {
      setProjectSettings({
        ...(parsed.method ? { apisMethod: parsed.method as "GET" | "POST" | "PUT" | "PATCH" | "DELETE" } : {}),
        ...(parsed.url ? { apisUrl: parsed.url } : {}),
        ...(parsed.headersText ? { apisHeadersText: parsed.headersText } : {}),
        ...(parsed.body !== undefined ? { apisBody: parsed.body } : {}),
      });
    }
    setUI({ apisCurlPaste: "" });
  };

  const applyOpenapi = () => {
    const openapiPaste = useUIStore.getState().apisOpenapiPaste;
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
    if (!ps.apisAuthTokenUrl || !ps.apisAuthClientId) return;
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const redirectUri = "http://localhost:8080/callback";
    const authorizeUrl = new URL(ps.apisAuthTokenUrl.replace("/token", "/authorize"));
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", ps.apisAuthClientId);
    authorizeUrl.searchParams.set("redirect_uri", redirectUri);
    authorizeUrl.searchParams.set("code_challenge", challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("state", Math.random().toString(36).slice(2));
    window.open(authorizeUrl.toString(), "_blank");
    setShowOauthDialog(true);
    setOauthCode("");
  };

  const exchangeOAuth2Code = async () => {
    if (!oauthCode.trim() || !ps.apisAuthTokenUrl || !ps.apisAuthClientId) return;
    setOauthLoading(true);
    try {
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code", code: oauthCode.trim(),
        redirect_uri: "http://localhost:8080/callback", client_id: ps.apisAuthClientId,
        client_secret: ps.apisAuthClientSecret,
      }).toString();
      const res = await httpRequest("POST", ps.apisAuthTokenUrl, { "Content-Type": "application/x-www-form-urlencoded" }, tokenBody);
      const token = (JSON.parse(res.body) as Record<string, string>).access_token || "";
      if (token) setProjectSettings({ apisAuthToken: token });
      setShowOauthDialog(false);
      setOauthCode("");
    } catch (e) {
      notify.error("OAuth token exchange failed", getErrorMessage(e));
    } finally {
      setOauthLoading(false);
    }
  };

  const send = async () => {
    if (!ps.apisUrl.trim()) return;
    setLoading(true);
    const start = Date.now();
    try {
      const resolvedUrl = resolveEnvVars(ps.apisUrl);
      const resolvedBody = ps.apisBody ? resolveEnvVars(ps.apisBody) : undefined;
      const headers: Record<string, string> = {};
      try {
        for (const [k, v] of Object.entries(JSON.parse(ps.apisHeadersText) as Record<string, string>))
          headers[k] = resolveEnvVars(v);
      } catch { /* ignore */ }
      if (ps.apisAuthType === "bearer" && ps.apisAuthToken) headers["Authorization"] = `Bearer ${ps.apisAuthToken}`;
      else if (ps.apisAuthType === "apikey" && ps.apisAuthToken) headers[ps.apisAuthHeaderName || "X-API-Key"] = ps.apisAuthToken;
      else if (ps.apisAuthType === "basic" && ps.apisAuthUsername) headers["Authorization"] = `Basic ${btoa(`${ps.apisAuthUsername}:${ps.apisAuthPassword}`)}`;
      else if (ps.apisAuthType === "oauth2" && ps.apisAuthToken) headers["Authorization"] = `Bearer ${ps.apisAuthToken}`;
      const res = await httpRequest(ps.apisMethod, resolvedUrl, headers, resolvedBody);
      const entry: ApiHistoryEntry = { timestamp: Date.now(), method: ps.apisMethod, url: ps.apisUrl, status: res.status, duration: Date.now() - start };
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
      let tsInterface = `export type ${buildInterfaceName(ps.apisName)} = unknown`;
      if (response?.body) {
        try {
          const parsed = JSON.parse(response.body) as unknown;
          tsInterface = jsonToTsInterface(buildInterfaceName(ps.apisName), parsed);
        } catch { /* keep fallback */ }
      }
      const serviceContent = buildServiceFile(
        {
          id: selectedApiId,
          name: ps.apisName,
          method: ps.apisMethod,
          url: ps.apisUrl,
          headersText: ps.apisHeadersText,
          body: ps.apisBody,
          authType: ps.apisAuthType,
          authToken: ps.apisAuthToken,
          authHeaderName: ps.apisAuthHeaderName,
          authUsername: ps.apisAuthUsername,
          authPassword: ps.apisAuthPassword,
          authTokenUrl: ps.apisAuthTokenUrl,
          authClientId: ps.apisAuthClientId,
          authClientSecret: ps.apisAuthClientSecret,
          proxyPath: ps.apisProxyPath,
          history,
        },
        tsInterface,
        buildInterfaceName(ps.apisName),
      );
      const slug = ps.apisName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
      return jsonToTsInterface(buildInterfaceName(ps.apisName || "Response"), parsed);
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
                onClick={() => setProjectSettings({ apisSidebarTab: sidebarTab === "collection" ? "keys" : "collection" })}
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
              <ApiKeysSection
                apiKeys={apiKeys}
                proxyMappings={proxyMappings}
                newKeyName={newKeyName}
                newKeyValue={newKeyValue}
                newKeyDesc={newKeyDesc}
                setNewKeyName={setNewKeyName}
                setNewKeyValue={setNewKeyValue}
                setNewKeyDesc={setNewKeyDesc}
                onAddKey={addApiKey}
                onUpdateKey={updateApiKey}
                onDeleteKey={deleteApiKey}
              />
            )}
          </div>
        </Allotment.Pane>

        {/* ── Main split (Request | Response) ── */}
        <Allotment.Pane>
          <Allotment>

            <Allotment.Pane minSize={320}>
              <RequestForm
                selectedApiId={selectedApiId}
                loading={loading}
                generatingService={generatingService}
                onSend={send}
                onSave={saveCurrent}
                onGenerateService={generateService}
                onApplyCurl={applyCurl}
                onApplyOpenapi={applyOpenapi}
                onStartOAuth2={startOAuth2}
              />
            </Allotment.Pane>

            <Allotment.Pane minSize={320}>
              <ResponseViewer
                response={response}
                history={history}
                schemaContent={schemaContent}
              />
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
