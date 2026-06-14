import { memo, useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Copy } from "lucide-react";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import type { Provider } from "@/lib/ipc";
import type { Message } from "@/lib/ipc";

interface PromptInspectorProps {
  model: string;
  messages: Message[];
  host: string;
  provider: Provider;
  /** The resolved think parameter being sent — undefined means not sent */
  think?: boolean | "low" | "medium" | "high";
  /** Whether the agent tool set is included in the request */
  hasTools?: boolean;
}

// Agent tool names sent by the Rust agent loop
const AGENT_TOOLS = ["write_file", "read_file", "edit_file", "run_tsc", "run_lint", "bash"];

function serializeMessage(m: Message): Record<string, unknown> {
  const result: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.images?.length) result["images"] = m.images;
  if (m.thinking) result["thinking"] = m.thinking;
  if (m.tool_calls?.length) result["tool_calls"] = m.tool_calls;
  if (m.tool_name) result["tool_name"] = m.tool_name;
  return result;
}

function buildOllamaPayload(
  model: string,
  messages: Message[],
  think: boolean | "low" | "medium" | "high" | undefined,
  hasTools: boolean,
  stream: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model,
    messages: messages.map(serializeMessage),
    stream,
  };
  if (think !== undefined) payload["think"] = think;
  if (hasTools) payload["tools"] = AGENT_TOOLS.map((name) => ({ type: "function", function: { name } }));
  return payload;
}

export const PromptInspector = memo(function PromptInspector({ model, messages, host, provider, think, hasTools = false }: PromptInspectorProps) {
  const isOllama = provider.startsWith("ollama");

  // Re-serializing every message into 3 payload shapes + a curl string is O(n) and
  // expensive (images carry base64 data) — only recompute when the request actually changes.
  const assembled = useMemo(() => messages.map((m) => {
    const imageNote = m.images?.length ? `\n[${m.images.length} image(s) attached]` : "";
    return `${m.role}: ${m.content}${imageNote}`;
  }).join("\n\n"), [messages]);

  const payload = useMemo(() => {
    if (isOllama) return JSON.stringify(buildOllamaPayload(model, messages, think, hasTools, true), null, 2);
    if (provider === "claude") {
      return JSON.stringify({ model, messages: messages.map(serializeMessage), max_tokens: 4096, stream: true }, null, 2);
    }
    return JSON.stringify({ model, messages: messages.map(serializeMessage), stream: true }, null, 2);
  }, [isOllama, provider, model, messages, think, hasTools]);

  const curl = useMemo(() => {
    if (isOllama) {
      return `curl -X POST ${host}/api/chat \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(buildOllamaPayload(model, messages, think, hasTools, false))}'`;
    }
    if (provider === "claude") {
      return `curl -X POST https://api.anthropic.com/v1/messages \\\n  -H "Content-Type: application/json" \\\n  -H "x-api-key: $ANTHROPIC_API_KEY" \\\n  -H "anthropic-version: 2023-06-01" \\\n  -d '${JSON.stringify({
        model,
        messages: messages.map(serializeMessage),
        max_tokens: 4096,
      })}'`;
    }
    return `curl -X POST https://api.openai.com/v1/chat/completions \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer $OPENAI_API_KEY" \\\n  -d '${JSON.stringify({
      model,
      messages: messages.map(serializeMessage),
    })}'`;
  }, [isOllama, provider, host, model, messages, think, hasTools]);

  const [copiedTab, setCopiedTab] = useState<string | null>(null);

  const handleCopy = async (text: string, tab: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedTab(tab);
    setTimeout(() => setCopiedTab(null), 1500);
  };

  return (
    <div className="h-full flex flex-col">
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
            {copiedTab === "assembled" ? "Copied!" : "Copy"}
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
            {copiedTab === "json" ? "Copied!" : "Copy"}
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
            {copiedTab === "curl" ? "Copied!" : "Copy"}
          </Button>
          <CodeMirrorEditor value={curl} mode="shell" readOnly />
        </TabsContent>
      </Tabs>
    </div>
  );
});
