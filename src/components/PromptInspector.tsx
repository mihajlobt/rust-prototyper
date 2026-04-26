import { useState, useMemo } from "react";
import { encodingForModel } from "js-tiktoken";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Copy, Eye } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import type { Provider } from "@/lib/ipc";
import type { Message } from "@/lib/ipc";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";

interface PromptInspectorProps {
  model: string;
  messages: Message[];
  host: string;
  provider: Provider;
}

function countTokens(text: string, model: string): number {
  try {
    const enc = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
    return enc.encode(text).length;
  } catch {
    try {
      const enc = encodingForModel("gpt-4");
      return enc.encode(text).length;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}

export function PromptInspector({ model, messages, host, provider }: PromptInspectorProps) {
  const caps = useModelCapabilities(model);
  const contextWindow = caps.contextLength ?? 8192;

  const assembled = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const tokenCount = useMemo(() => countTokens(assembled, model), [assembled, model]);
  const usagePercent = Math.min(100, Math.round((tokenCount / contextWindow) * 100));

  const isOllama = provider.startsWith("ollama");

  const curl = isOllama
    ? `curl -X POST ${host}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    })}'`
    : provider === "claude"
      ? `curl -X POST https://api.anthropic.com/v1/messages \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: $ANTHROPIC_API_KEY" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '${JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: 4096,
    })}'`
      : `curl -X POST https://api.openai.com/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -d '${JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })}'`;

  const payload = JSON.stringify(
    {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    },
    null,
    2
  );

  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const handleCopy = async (text: string, tab: string) => {
    await writeText(text);
    setCopiedTab(tab);
  };

  const handleCopiedAnimationEnd = () => {
    setCopiedTab(null);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
        <Eye size={14} />
        <span className="text-sm font-medium">Prompt Inspector</span>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <div className="w-[100px] h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className={[
                "h-full rounded-full",
                usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-yellow-500" : "bg-green-500",
              ].join(" ")}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            ~{tokenCount} / {contextWindow.toLocaleString()} tokens ({usagePercent}%)
          </span>
        </div>
      </div>
      <Tabs defaultValue="assembled" className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="line" className="h-7">
          <TabsTrigger value="assembled" className="text-[11px]">Assembled</TabsTrigger>
          <TabsTrigger value="json" className="text-[11px]">JSON</TabsTrigger>
          <TabsTrigger value="curl" className="text-[11px]">cURL</TabsTrigger>
        </TabsList>

        <TabsContent value="assembled" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(assembled, "assembled")}
          >
            <Copy size={12} />
            {copiedTab === "assembled" ? (
              <span className="animate-fade-out" onAnimationEnd={handleCopiedAnimationEnd}>Copied!</span>
            ) : "Copy"}
          </Button>
          <CodeMirrorEditor value={assembled} mode="markdown" readOnly />
        </TabsContent>

        <TabsContent value="json" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(payload, "json")}
          >
            <Copy size={12} />
            {copiedTab === "json" ? (
              <span className="animate-fade-out" onAnimationEnd={handleCopiedAnimationEnd}>Copied!</span>
            ) : "Copy"}
          </Button>
          <CodeMirrorEditor value={payload} mode="json" readOnly />
        </TabsContent>

        <TabsContent value="curl" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(curl, "curl")}
          >
            <Copy size={12} />
            {copiedTab === "curl" ? (
              <span className="animate-fade-out" onAnimationEnd={handleCopiedAnimationEnd}>Copied!</span>
            ) : "Copy"}
          </Button>
          <CodeMirrorEditor value={curl} mode="shell" readOnly />
        </TabsContent>
      </Tabs>
    </div>
  );
}