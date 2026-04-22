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
import { httpRequest, type HttpResponse } from "@/lib/ipc";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import YAML from "js-yaml";

interface ApiHistoryEntry {
  timestamp: number;
  method: string;
  url: string;
  status: number;
  duration?: number;
}

interface SavedApi {
  id: string;
  name: string;
  method: string;
  url: string;
  headersText: string;
  body: string;
  authType: "none" | "bearer" | "apikey" | "basic" | "oauth2";
  authToken: string;
  authUsername: string;
  authPassword: string;
  history: ApiHistoryEntry[];
}

const STORAGE_KEY = "prototyper_apis";

function loadApis(): SavedApi[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return [];
}

function saveApis(apis: SavedApi[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(apis));
}

function generateId() {
  return `api_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function parseCurl(input: string): Partial<SavedApi> | null {
  const methodMatch = input.match(/curl\s+(-X\s+(\w+)\s+)?['"]?(https?:\/\/[^\s'"]+)['"]?/);
  if (!methodMatch) return null;
  const url = methodMatch[3];
  const method = methodMatch[2] || "GET";
  const headers: Record<string, string> = {};
  const headerMatches = input.matchAll(/-H\s+['"]([^:]+):\s*([^'"]+)['"]/g);
  for (const m of headerMatches) {
    headers[m[1].trim()] = m[2].trim();
  }
  const bodyMatch = input.match(/-d\s+['"]([\s\S]*?)['"]\s*(?:-H|-X|curl|$)/);
  const body = bodyMatch ? bodyMatch[1] : "";
  return { url, method: method.toUpperCase(), headersText: JSON.stringify(headers, null, 2), body };
}

export function APIsPanel() {
  const [apis, setApis] = useState<SavedApi[]>(loadApis);
  const [selectedApiId, setSelectedApiId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [headersText, setHeadersText] = useState("{}");
  const [body, setBody] = useState("");
  const [authType, setAuthType] = useState<"none" | "bearer" | "apikey" | "basic" | "oauth2">("none");
  const [authToken, setAuthToken] = useState("");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [response, setResponse] = useState<HttpResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [curlPaste, setCurlPaste] = useState("");
  const [openapiPaste, setOpenapiPaste] = useState("");
  const [history, setHistory] = useState<ApiHistoryEntry[]>([]);

  useEffect(() => {
    saveApis(apis);
  }, [apis]);

  const selectApi = useCallback((api: SavedApi) => {
    setSelectedApiId(api.id);
    setName(api.name);
    setMethod(api.method);
    setUrl(api.url);
    setHeadersText(api.headersText);
    setBody(api.body);
    setAuthType(api.authType);
    setAuthToken(api.authToken);
    setAuthUsername(api.authUsername || "");
    setAuthPassword(api.authPassword || "");
    setHistory(api.history || []);
    setResponse(null);
  }, []);

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
      authUsername: "",
      authPassword: "",
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
          ? { ...a, name: name || a.name, method, url, headersText, body, authType, authToken, authUsername, authPassword, history }
          : a
      )
    );
  };

  const deleteApi = (id: string) => {
    setApis((prev) => prev.filter((a) => a.id !== id));
    if (selectedApiId === id) {
      setSelectedApiId(null);
      setName("");
      setMethod("GET");
      setUrl("");
      setHeadersText("{}");
      setBody("");
      setAuthType("none");
      setAuthToken("");
      setHistory([]);
    }
  };

  const applyCurl = () => {
    if (!curlPaste.trim()) return;
    const parsed = parseCurl(curlPaste);
    if (parsed) {
      if (parsed.method) setMethod(parsed.method);
      if (parsed.url) setUrl(parsed.url);
      if (parsed.headersText) setHeadersText(parsed.headersText);
      if (parsed.body !== undefined) setBody(parsed.body);
    }
    setCurlPaste("");
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
            authUsername: "",
            authPassword: "",
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
    setOpenapiPaste("");
  };

  const send = async () => {
    if (!url.trim()) return;
    setLoading(true);
    const start = Date.now();
    try {
      let headers: Record<string, string> = {};
      try {
        headers = JSON.parse(headersText);
      } catch {
        // ignore invalid JSON
      }
      if (authType === "bearer" && authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      } else if (authType === "apikey" && authToken) {
        headers["X-API-Key"] = authToken;
      } else if (authType === "basic" && authUsername) {
        const encoded = btoa(`${authUsername}:${authPassword}`);
        headers["Authorization"] = `Basic ${encoded}`;
      } else if (authType === "oauth2" && authToken) {
        headers["Authorization"] = `Bearer ${authToken}`;
      }
      const res = await httpRequest(method, url, headers, body || undefined);
      setResponse(res);
      const entry: ApiHistoryEntry = {
        timestamp: Date.now(),
        method,
        url,
        status: res.status,
        duration: Date.now() - start,
      };
      const nextHistory = [entry, ...history].slice(0, 50);
      setHistory(nextHistory);
      if (selectedApiId) {
        setApis((prev) =>
          prev.map((a) => (a.id === selectedApiId ? { ...a, history: nextHistory } : a))
        );
      }
    } catch (e) {
      setResponse({
        status: 0,
        headers: {},
        body: `Error: ${e instanceof Error ? e.message : String(e)}`,
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment>
        {/* APIs Sidebar */}
        <Allotment.Pane preferredSize={220} minSize={180}>
          <div className="h-full flex flex-col bg-card border-r border-border">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
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
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
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
                    onChange={(e) => setName(e.target.value)}
                    className="h-8 text-sm"
                  />

                  <div className="flex gap-2">
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger className="w-[100px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
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
                      onChange={(e) => setUrl(e.target.value)}
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
                        onChange={(e) => setCurlPaste(e.target.value)}
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
                        onChange={(e) => setOpenapiPaste(e.target.value)}
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
                        onValueChange={(v) => setAuthType(v as "none" | "bearer" | "apikey" | "basic" | "oauth2")}
                      >
                        <SelectTrigger className="w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="bearer">Bearer</SelectItem>
                          <SelectItem value="apikey">API Key</SelectItem>
                          <SelectItem value="basic">Basic</SelectItem>
                          <SelectItem value="oauth2">OAuth2</SelectItem>
                        </SelectContent>
                      </Select>
                      {authType === "bearer" && (
                        <Input type="password" placeholder="Bearer token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} className="h-8 text-xs" />
                      )}
                      {authType === "apikey" && (
                        <Input type="password" placeholder="API Key" value={authToken} onChange={(e) => setAuthToken(e.target.value)} className="h-8 text-xs" />
                      )}
                      {authType === "oauth2" && (
                        <Input type="password" placeholder="Access token" value={authToken} onChange={(e) => setAuthToken(e.target.value)} className="h-8 text-xs" />
                      )}
                    </div>
                    {authType === "basic" && (
                      <div className="flex gap-2">
                        <Input placeholder="Username" value={authUsername} onChange={(e) => setAuthUsername(e.target.value)} className="h-8 text-xs" />
                        <Input type="password" placeholder="Password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} className="h-8 text-xs" />
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Headers (JSON)</label>
                    <div className="h-32 border rounded overflow-hidden">
                      <CodeMirrorEditor value={headersText} onChange={setHeadersText} mode="json" />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Body</label>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Request body..."
                      className="min-h-[120px] text-sm font-mono"
                    />
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            {/* Response */}
            <Allotment.Pane minSize={320}>
              <div className="h-full flex flex-col bg-card">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
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
                  <TabsList className="grid w-full grid-cols-3 shrink-0">
                    <TabsTrigger value="body">Body</TabsTrigger>
                    <TabsTrigger value="headers">Headers</TabsTrigger>
                    <TabsTrigger value="history">History</TabsTrigger>
                  </TabsList>

                  <TabsContent value="body" className="flex-1 overflow-auto p-3 mt-0">
                    {response ? (
                      <div className="relative">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="absolute top-0 right-0 z-10 gap-1 text-xs"
                          onClick={() => navigator.clipboard.writeText(response.body)}
                        >
                          <Copy size={12} />
                          Copy
                        </Button>
                        <pre className="text-xs bg-muted p-2 rounded overflow-auto whitespace-pre-wrap">
                          {response.body}
                        </pre>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                        Send a request to see the response
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="headers" className="flex-1 overflow-auto p-3 mt-0">
                    {response ? (
                      <pre className="text-xs bg-muted p-2 rounded overflow-auto">
                        {JSON.stringify(response.headers, null, 2)}
                      </pre>
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
    </div>
  );
}
