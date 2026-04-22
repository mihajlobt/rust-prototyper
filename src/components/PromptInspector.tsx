import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Copy, Eye } from "lucide-react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { getContextWindow } from "@/lib/ipc";

interface PromptInspectorProps {
  model: string;
  messages: Array<{ role: string; content: string }>;
  host: string;
}

function estimateTokens(text: string): number {
  // Heuristic: ~4 chars per token for English text
  // This avoids the ESM/CJS incompatibility of js-tiktoken
  return Math.ceil(text.length / 4);
}

export function PromptInspector({ model, messages, host }: PromptInspectorProps) {
  const [copied, setCopied] = useState(false);

  const assembled = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
  const tokenCount = useMemo(() => estimateTokens(assembled), [assembled]);
  const contextWindow = getContextWindow(model);
  const usagePercent = Math.min(100, Math.round((tokenCount / contextWindow) * 100));

  const payload = JSON.stringify(
    {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    },
    null,
    2
  );

  const isOllama = !model.startsWith("gpt-") && !model.startsWith("o1-") && !model.startsWith("o3-") && !model.startsWith("claude-");

  const curl = isOllama
    ? `curl -X POST ${host}/api/chat \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
    })}'`
    : model.startsWith("claude-")
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

  const handleCopy = async (text: string) => {
    await writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
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
        <TabsList className="grid w-full grid-cols-3 shrink-0">
          <TabsTrigger value="assembled">Assembled</TabsTrigger>
          <TabsTrigger value="json">JSON Payload</TabsTrigger>
          <TabsTrigger value="curl">cURL</TabsTrigger>
        </TabsList>

        <TabsContent value="assembled" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(assembled)}
          >
            <Copy size={12} />
            {copied ? "Copied!" : "Copy"}
          </Button>
          <CodeMirrorEditor value={assembled} mode="markdown" readOnly />
        </TabsContent>

        <TabsContent value="json" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(payload)}
          >
            <Copy size={12} />
            Copy
          </Button>
          <CodeMirrorEditor value={payload} mode="json" readOnly />
        </TabsContent>

        <TabsContent value="curl" className="flex-1 overflow-hidden mt-0 relative">
          <Button
            variant="ghost"
            size="sm"
            className="absolute top-2 right-2 z-10 gap-1 text-xs"
            onClick={() => handleCopy(curl)}
          >
            <Copy size={12} />
            Copy
          </Button>
          <CodeMirrorEditor value={curl} mode="shell" readOnly />
        </TabsContent>
      </Tabs>
    </div>
  );
}