import { useState, useRef } from "react";
import { Server, Cloud, Zap, Bot, ChevronDown, Check } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  listOllamaModels,
} from "@/lib/ipc";
import { OPENAI_MODELS, ANTHROPIC_MODELS } from "@/lib/models";
import { useAppStore } from "@/stores/appStore";

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  host: string;
  ollamaApiKey?: string;
  cloudModelIds?: ReadonlyArray<string>;
}

type Status = "loading" | "online" | "offline";

const CLOUD_CAPS: Record<string, { capabilities: string[]; contextLength: number }> = {
  "gpt-4o":                    { capabilities: ["completion", "vision", "tools"], contextLength: 128000 },
  "gpt-4o-mini":               { capabilities: ["completion", "vision", "tools"], contextLength: 128000 },
  "o3-mini":                   { capabilities: ["completion", "tools", "thinking"], contextLength: 200000 },
  "o1":                        { capabilities: ["completion", "thinking"], contextLength: 200000 },
  "claude-opus-4-7":           { capabilities: ["completion", "vision", "tools"], contextLength: 200000 },
  "claude-sonnet-4-6":         { capabilities: ["completion", "vision", "tools"], contextLength: 200000 },
  "claude-haiku-4-5-20251001": { capabilities: ["completion", "vision", "tools"], contextLength: 200000 },
};

function formatContextK(ctxK?: number): string | null {
  if (!ctxK) return null;
  if (ctxK >= 1000) return `${(ctxK / 1000).toFixed(0)}M`;
  return `${ctxK}K`;
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span className={[
      "w-1.5 h-1.5 rounded-full shrink-0",
      status === "online"  ? "bg-emerald-500" :
      status === "loading" ? "bg-amber-500 animate-pulse" :
                             "bg-muted-foreground/30",
    ].join(" ")} />
  );
}

function CapBadge({ label, color }: { label: string; color: string }) {
  return (
    <span className={`inline-flex items-center text-[9px] font-semibold px-1 py-px rounded-sm leading-none ${color}`}>
      {label}
    </span>
  );
}

function ModelCard({
  model,
  isActive,
  onClick,
  capabilities,
  contextLength,
}: {
  model: { id: string; name: string };
  isActive: boolean;
  onClick: () => void;
  capabilities?: string[];
  contextLength?: number;
}) {
  const caps = capabilities ?? CLOUD_CAPS[model.id]?.capabilities ?? [];
  const ctxValue = contextLength ?? CLOUD_CAPS[model.id]?.contextLength;
  const ctxK = ctxValue ? Math.round(ctxValue / 1000) : undefined;
  const ctxStr = formatContextK(ctxK);
  const hasBadges = caps.includes("thinking") || caps.includes("vision") || caps.includes("tools") || ctxStr;

  return (
    <button
      onClick={onClick}
      className={[
        "w-full flex items-start gap-2 px-2.5 py-1.5 text-left transition-colors rounded-sm mx-1",
        isActive ? "bg-accent/20" : "hover:bg-accent/10",
      ].join(" ")}
      style={{ width: "calc(100% - 8px)" }}
    >
      <div className="flex-1 min-w-0 pt-px">
        <div className="flex items-center gap-1.5">
          <span className={`text-xs truncate leading-tight ${isActive ? "text-foreground font-medium" : "text-foreground"}`}>
            {model.name}
          </span>
          {isActive && <Check size={10} className="text-primary shrink-0" />}
        </div>
        {hasBadges && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            {caps.includes("thinking") && <CapBadge label="Think" color="bg-violet-500/15 text-violet-400" />}
            {caps.includes("vision")   && <CapBadge label="Vision" color="bg-sky-500/15 text-sky-400" />}
            {caps.includes("tools")    && <CapBadge label="Tools" color="bg-emerald-500/15 text-emerald-400" />}
            {ctxStr                    && <CapBadge label={ctxStr} color="bg-muted text-muted-foreground" />}
          </div>
        )}
      </div>
    </button>
  );
}

function SectionHeader({
  icon,
  label,
  status,
}: {
  icon: React.ReactNode;
  label: string;
  status?: Status;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
      {icon}
      {label}
      {status !== undefined && <StatusDot status={status} />}
    </div>
  );
}

export function ModelPicker({ value, onChange, host, ollamaApiKey = "" }: ModelPickerProps) {
  const settings = useAppStore((s) => s.settings);
  const [manualValue, setManualValue] = useState("");
  const [showManual, setShowManual] = useState(false);
  const manualRef = useRef<HTMLInputElement>(null);

  // TanStack Query: fetch local Ollama models (with capabilities from /api/show)
  // Per docs/api/tanstack-query.md: staleTime=15s for polling, refetchInterval for live updates
  const localQuery = useQuery({
    queryKey: ["ollama-models", "local", host],
    queryFn: async () => {
      const models = await listOllamaModels(host, "");
      return models;
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
    retry: 1,
  });

  // TanStack Query: fetch cloud Ollama models (only when API key present)
  const cloudQuery = useQuery({
    queryKey: ["ollama-models", "cloud", ollamaApiKey],
    queryFn: () => listOllamaModels("https://ollama.com", ollamaApiKey),
    enabled: !!ollamaApiKey,
    staleTime: 60_000,
    retry: 1,
  });

  const localModels = localQuery.data ?? [];
  const localStatus: Status = localQuery.isPending ? "loading" : localQuery.isError ? "offline" : "online";
  const cloudModels = cloudQuery.data ?? [];
  const cloudStatus: Status = !ollamaApiKey ? "offline" : cloudQuery.isPending ? "loading" : cloudQuery.isError ? "offline" : "online";

  const triggerLabel = value || "Select model";

  const cloudIds = new Set(cloudModels.map((m) => m.id));

  const hasOpenAIKey = !!(settings.apiKeys["openai"]);
  const hasAnthropicKey = !!(settings.apiKeys["claude"]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7 max-w-[220px]">
          <span className="text-muted-foreground">
            {value.startsWith("gpt-") || value.startsWith("o1") || value.startsWith("o3")
              ? <Zap size={11} />
              : value.startsWith("claude-")
              ? <Bot size={11} />
              : cloudIds.has(value)
              ? <Cloud size={11} />
              : <Server size={11} />
            }
          </span>
          <span className="truncate flex-1 text-left">{triggerLabel}</span>
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-72 p-1" style={{ maxHeight: "480px", overflowY: "auto" }}>

        {localStatus !== "offline" && (
          <>
            <SectionHeader icon={<Server size={11} />} label="Ollama Local" status={localStatus} />
            {localStatus === "loading" && (
              <p className="text-[10px] text-muted-foreground px-2.5 py-1">Connecting…</p>
            )}
            {localStatus !== "loading" && localModels.length === 0 && (
              <p className="text-[10px] text-muted-foreground px-2.5 py-1">No local models</p>
            )}
            {localModels.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                isActive={value === m.id}
                onClick={() => onChange(m.id)}
                capabilities={m.capabilities}
                contextLength={m.contextLength}
              />
            ))}
          </>
        )}

        {ollamaApiKey && cloudStatus !== "offline" && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <SectionHeader icon={<Cloud size={11} />} label="Ollama Cloud" status={cloudStatus} />
            {cloudStatus === "loading" && (
              <p className="text-[10px] text-muted-foreground px-2.5 py-1">Loading…</p>
            )}
            {cloudModels.map((m) => (
              <ModelCard
                key={m.id}
                model={m}
                isActive={value === m.id}
                onClick={() => onChange(m.id)}
                capabilities={m.capabilities}
                contextLength={m.contextLength}
              />
            ))}
          </>
        )}

        {hasOpenAIKey && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <SectionHeader icon={<Zap size={11} />} label="OpenAI" />
            {OPENAI_MODELS.map((m) => (
              <ModelCard key={m.id} model={m} isActive={value === m.id} onClick={() => onChange(m.id)} />
            ))}
          </>
        )}

        {hasAnthropicKey && (
          <>
            <DropdownMenuSeparator className="my-1" />
            <SectionHeader icon={<Bot size={11} />} label="Anthropic" />
            {ANTHROPIC_MODELS.map((m) => (
              <ModelCard key={m.id} model={m} isActive={value === m.id} onClick={() => onChange(m.id)} />
            ))}
          </>
        )}

        <DropdownMenuSeparator className="my-1" />
        {showManual ? (
          <div className="px-2 py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <Input
              ref={manualRef}
              value={manualValue}
              onChange={(e) => setManualValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && manualValue.trim()) {
                  onChange(manualValue.trim());
                  setManualValue("");
                  setShowManual(false);
                }
                if (e.key === "Escape") setShowManual(false);
              }}
              placeholder="model-id… (Enter to apply)"
              className="h-7 text-xs"
            />
          </div>
        ) : (
          <button
            onClick={() => setShowManual(true)}
            className="w-full text-left text-[10px] text-muted-foreground hover:text-foreground px-2.5 py-1.5 transition-colors"
          >
            Enter model ID manually…
          </button>
        )}

      </DropdownMenuContent>
    </DropdownMenu>
  );
}