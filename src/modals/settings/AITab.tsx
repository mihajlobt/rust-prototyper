import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Server, Cloud, Zap, Bot } from "lucide-react";
import type { Settings } from "@/hooks/useSettings";

interface AITabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

export function AITab({ settings, setSettings }: AITabProps) {
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
      </div>
    </ScrollArea>
  );
}
