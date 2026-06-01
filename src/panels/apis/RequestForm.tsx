// ─── Request form sub-component (left pane of the request/response split) ───

import { Send, Save, Plug, Plus, Trash2 } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore } from "@/stores/uiStore";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type AuthType = "none" | "bearer" | "apikey" | "basic" | "oauth2";

export interface RequestFormState {
  name: string;
  method: HttpMethod;
  url: string;
  headersText: string;
  body: string;
  authType: AuthType;
  authToken: string;
  authHeaderName: string;
  authUsername: string;
  authPassword: string;
  authTokenUrl: string;
  authClientId: string;
  authClientSecret: string;
  proxyPath: string;
}

export interface RequestFormProps {
  selectedApiId: string | null;
  loading: boolean;
  generatingService: boolean;
  onSend: () => void;
  onSave: () => void;
  onGenerateService: () => void;
  onApplyCurl: () => void;
  onApplyOpenapi: () => void;
  onStartOAuth2: () => void;
}

export function RequestForm({
  selectedApiId,
  loading,
  generatingService,
  onSend,
  onSave,
  onGenerateService,
  onApplyCurl,
  onApplyOpenapi,
  onStartOAuth2,
}: RequestFormProps) {
  const { ps, setProjectSettings } = useProjectSettingsStore();
  const setUI = useUIStore.setState;

  // Form values are persisted in the project settings store so they survive
  // project switches and re-renders — same pattern as the original panel.
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

  // Ephemeral UI state (sticky across selections via uiStore)
  const envVars = useUIStore((s) => s.apisEnvVars);
  const newEnvKey = useUIStore((s) => s.apisNewEnvKey);
  const newEnvValue = useUIStore((s) => s.apisNewEnvValue);
  const curlPaste = useUIStore((s) => s.apisCurlPaste);
  const openapiPaste = useUIStore((s) => s.apisOpenapiPaste);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">Request</span>
        <div className="flex-1" />
        {selectedApiId && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={onGenerateService}
            disabled={generatingService}
            title="Generate a typed TanStack Query service file in src/services/"
          >
            <Plug size={11} />
            {generatingService ? "Generating…" : "Service"}
          </Button>
        )}
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onSave}>
          <Save size={12} />
          Save
        </Button>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        <div className="p-3 space-y-3">
          <Input
            placeholder="API Name"
            value={name}
            onChange={(e) => setProjectSettings({ apisName: e.target.value })}
            className="h-8 text-sm"
          />

          <div className="flex gap-2">
            <Select value={method} onValueChange={(v) => setProjectSettings({ apisMethod: v as HttpMethod })}>
              <SelectTrigger className="w-[100px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper" side="bottom">
                {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="https://api.example.com/endpoint"
              value={url}
              onChange={(e) => setProjectSettings({ apisUrl: e.target.value })}
            />
            <Button onClick={onSend} disabled={loading}>
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
              onChange={(e) => setProjectSettings({ apisProxyPath: e.target.value })}
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
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onApplyCurl}>Parse</Button>
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
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onApplyOpenapi}>Import</Button>
            </div>
          </div>

          {/* Auth */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Authentication</label>
            <div className="flex gap-2 flex-wrap">
              <Select value={authType} onValueChange={(v) => setProjectSettings({ apisAuthType: v as AuthType })}>
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
                <Input type="password" placeholder="Bearer token" value={authToken} onChange={(e) => setProjectSettings({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
              )}
              {authType === "apikey" && (
                <>
                  <Input placeholder="Header name" value={authHeaderName} onChange={(e) => setProjectSettings({ apisAuthHeaderName: e.target.value })} className="h-8 text-xs w-[140px]" />
                  <Input type="password" placeholder="API Key" value={authToken} onChange={(e) => setProjectSettings({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
                </>
              )}
              {authType === "oauth2" && (
                <Input type="password" placeholder="Access token" value={authToken} onChange={(e) => setProjectSettings({ apisAuthToken: e.target.value })} className="h-8 text-xs flex-1" />
              )}
            </div>
            {authType === "basic" && (
              <div className="flex gap-2">
                <Input placeholder="Username" value={authUsername} onChange={(e) => setProjectSettings({ apisAuthUsername: e.target.value })} className="h-8 text-xs" />
                <Input type="password" placeholder="Password" value={authPassword} onChange={(e) => setProjectSettings({ apisAuthPassword: e.target.value })} className="h-8 text-xs" />
              </div>
            )}
            {authType === "oauth2" && (
              <div className="space-y-2">
                <Input placeholder="Token endpoint URL" value={authTokenUrl} onChange={(e) => setProjectSettings({ apisAuthTokenUrl: e.target.value })} className="h-8 text-xs" />
                <div className="flex gap-2">
                  <Input placeholder="Client ID" value={authClientId} onChange={(e) => setProjectSettings({ apisAuthClientId: e.target.value })} className="h-8 text-xs" />
                  <Input type="password" placeholder="Client Secret" value={authClientSecret} onChange={(e) => setProjectSettings({ apisAuthClientSecret: e.target.value })} className="h-8 text-xs" />
                </div>
                <Input type="password" placeholder="Access token (auto-filled after auth)" value={authToken} onChange={(e) => setProjectSettings({ apisAuthToken: e.target.value })} className="h-8 text-xs" />
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onStartOAuth2} disabled={!authTokenUrl || !authClientId}>Authorize</Button>
              </div>
            )}
          </div>

          {/* Headers */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Headers (JSON)</label>
            <div className="h-32 border rounded overflow-hidden">
              <CodeMirrorEditor value={headersText} onChange={(v) => setProjectSettings({ apisHeadersText: v })} mode="json" />
            </div>
          </div>

          {/* Body */}
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Body</label>
            <Textarea
              value={body}
              onChange={(e) => setProjectSettings({ apisBody: e.target.value })}
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
  );
}
