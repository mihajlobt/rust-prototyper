import type { ChatMessage } from "@/types/chat";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { cn } from "@/lib/utils";

interface TokenUsageBadgeProps {
  model: string;
  messages: ChatMessage[];
}

/** Compact token usage bar shown in the Inspector pane header. */
export function TokenUsageBadge({ model, messages }: TokenUsageBadgeProps) {
  const caps = useModelCapabilities(model);
  const contextWindow = caps.contextLength ?? 8192;
  const usage = [...messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage;
  const tokenCount = usage ? usage.prompt_tokens + usage.completion_tokens : 0;
  const usagePercent = Math.min(100, Math.round((tokenCount / contextWindow) * 100));

  return (
    <div className="flex items-center gap-2 mr-2">
      <div className="w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full",
            usagePercent > 90 ? "bg-red-500" : usagePercent > 70 ? "bg-yellow-500" : "bg-green-500",
          )}
          style={{ width: `${usagePercent}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">
        {tokenCount} / {contextWindow.toLocaleString()} ({usagePercent}%)
      </span>
    </div>
  );
}
