import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Server, Cloud, Zap, Bot, Search, CheckCircle2, XCircle, FileCheck2 } from "lucide-react";
import type { Settings } from "@/hooks/useSettings";
import { setupSearxngConfig, testSearxngConnection } from "@/lib/ipc";

interface AITabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

export function AITab({ settings, setSettings }: AITabProps) {
  const [searxngStatus, setSearxngStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [searxngConfigPath, setSearxngConfigPath] = useState<string | null>(null);
  const [configStatus, setConfigStatus] = useState<"idle" | "creating" | "ok" | "fail">("idle");
  const [configError, setConfigError] = useState<string | null>(null);

  async function testSearxng() {
    const url = (settings.searxngUrl ?? "").trim();
    if (!url) return;
    setSearxngStatus("testing");
    try {
      await testSearxngConnection(url);
      setSearxngStatus("ok");
    } catch {
      setSearxngStatus("fail");
    }
  }

  async function createSearxngConfig() {
    setConfigStatus("creating");
    setConfigError(null);
    try {
      const path = await setupSearxngConfig();
      setSearxngConfigPath(path);
      setConfigStatus("ok");
    } catch (e) {
      setConfigError(String(e));
      setConfigStatus("fail");
    }
  }

  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-6">

        {/* Providers — 2-col grid */}
        <section className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Providers</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Server size={13} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Ollama Local</span>
              </div>
              <Input value={settings.host} onChange={(e) => setSettings({ host: e.target.value })}
                placeholder="http://localhost:11434" className="h-8 text-xs" />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Cloud size={13} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Ollama Cloud</span>
              </div>
              <Input type="password" value={settings.apiKeys["ollama"] ?? ""}
                onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, ollama: e.target.value } })}
                placeholder="API key" className="h-8 text-xs" />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Zap size={13} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">OpenAI</span>
              </div>
              <Input type="password" value={settings.apiKeys["openai"] ?? ""}
                onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, openai: e.target.value } })}
                placeholder="sk-..." className="h-8 text-xs" />
            </div>
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Bot size={13} className="text-muted-foreground shrink-0" />
                <span className="text-sm font-medium">Anthropic</span>
              </div>
              <Input type="password" value={settings.apiKeys["claude"] ?? ""}
                onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, claude: e.target.value } })}
                placeholder="sk-ant-..." className="h-8 text-xs" />
            </div>
          </div>
        </section>

        {/* SearXNG */}
        <section className="border-t border-border pt-4 space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Web Search</p>
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Search size={13} className="text-muted-foreground shrink-0" />
              <span className="text-sm font-medium">SearXNG</span>
            </div>
            <div className="flex gap-2">
              <Input
                value={settings.searxngUrl ?? ""}
                onChange={(e) => { setSettings({ searxngUrl: e.target.value }); setSearxngStatus("idle"); }}
                placeholder="http://localhost:8080"
                className="h-8 text-xs flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0"
                disabled={!settings.searxngUrl?.trim() || searxngStatus === "testing"}
                onClick={testSearxng}
              >
                {searxngStatus === "ok" && <CheckCircle2 size={12} className="text-green-500" />}
                {searxngStatus === "fail" && <XCircle size={12} className="text-destructive" />}
                {searxngStatus === "testing" ? "Testing…" : searxngStatus === "idle" ? "Test" : searxngStatus === "ok" ? "OK" : "Failed"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Enables the <span className="font-mono">web_search</span> agent tool. Enable per-panel in Settings → Agents.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs shrink-0"
                disabled={configStatus === "creating"}
                onClick={createSearxngConfig}
              >
                {configStatus === "ok" ? <FileCheck2 size={12} className="text-green-500" /> : null}
                {configStatus === "creating" ? "Creating…" : configStatus === "ok" ? "Config created" : "Create default config"}
              </Button>
              {configStatus === "fail" && configError && (
                <span className="text-[11px] text-destructive truncate" title={configError}>{configError}</span>
              )}
            </div>
            {searxngConfigPath && (
              <>
                <p className="text-[11px] text-muted-foreground">
                  Mount this path into SearXNG&apos;s <span className="font-mono">/etc/searxng</span> when starting the container:
                </p>
                <p className="text-[11px] text-muted-foreground font-mono bg-muted rounded px-2 py-1 select-all whitespace-pre">
{searxngConfigPath}
                </p>
                <p className="text-[11px] text-muted-foreground">docker run:</p>
                <p className="text-[11px] text-muted-foreground font-mono bg-muted rounded px-2 py-1 select-all whitespace-pre">
{`docker run -d -p 8080:8080 -e BASE_URL=/ \\
  -v ${searxngConfigPath}:/etc/searxng:rw \\
  --name searxng --restart=unless-stopped \\
  searxng/searxng`}
                </p>
              </>
            )}
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
