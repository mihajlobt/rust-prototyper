import type { ChatMessage } from "@/types/chat";
import { useModelCapabilities } from "@/hooks/useModelCapabilities";
import { useChatStore } from "@/stores/chatStore";
import { useAppStore } from "@/stores/appStore";
import { getEffectiveContextWindow } from "@/hooks/chat/contextWindow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface TokenUsageBadgeProps {
  model: string;
  messages: ChatMessage[];
  entityId: string;
}

/** Compact token usage bar shown in the Inspector pane header. */
export function TokenUsageBadge({ model, messages, entityId }: TokenUsageBadgeProps) {
  const caps = useModelCapabilities(model);
  const provider = useAppStore((s) => s.settings.provider);
  const modelOptions = useAppStore((s) => s.settings.modelOptions);
  const { value: contextWindow, isUpperBound } = getEffectiveContextWindow(
    provider, modelOptions.numCtx, caps.modelfileNumCtx, caps.contextLength,
  );
  const isStreaming = useChatStore((s) => s.chats[entityId]?.isStreaming ?? false);
  const liveTokenCount = useChatStore((s) => s.chats[entityId]?.liveTokenCount ?? 0);
  const usage = [...messages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage;
  const settledCount = usage ? usage.prompt_tokens + usage.completion_tokens : 0;
  const tokenCount = isStreaming ? settledCount + liveTokenCount : settledCount;
  const usagePercent = Math.min(100, Math.round((tokenCount / contextWindow) * 100));

  const usageLabel = (
    <span className="text-[10px] text-muted-foreground tabular-nums">
      {tokenCount} / {contextWindow.toLocaleString()} ({usagePercent}%)
    </span>
  );

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
      {isUpperBound ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{usageLabel}</TooltipTrigger>
            <TooltipContent side="top">
              {contextWindow.toLocaleString()} is this model&apos;s max context. Ollama
              may be using a smaller window (default 4096) — set &quot;Context Size&quot;
              in model options to confirm.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : usageLabel}
    </div>
  );
}
