import { useState, useEffect, useRef } from "react";
import { Server, Cloud, Zap, Bot, ChevronDown, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { listOllamaModels, type ModelInfo } from "@/lib/ipc";
import { OPENAI_MODELS, ANTHROPIC_MODELS } from "@/lib/models";

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  host: string;
  ollamaApiKey?: string;
  cloudModelIds?: ReadonlyArray<string>;
}

type Status = "loading" | "online" | "offline";

function StatusDot({ status }: { status: Status }) {
  return (
    <span className={[
      "w-1.5 h-1.5 rounded-full shrink-0",
      status === "online"  ? "bg-green-500" :
      status === "loading" ? "bg-yellow-500 animate-pulse" :
                             "bg-muted-foreground/40",
    ].join(" ")} />
  );
}

function providerIcon(modelId: string, cloudModelIds: ReadonlyArray<string>) {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")) return <Zap size={11} />;
  if (modelId.startsWith("claude-")) return <Bot size={11} />;
  if (cloudModelIds.includes(modelId)) return <Cloud size={11} />;
  return <Server size={11} />;
}

export function ModelPicker({ value, onChange, host, ollamaApiKey = "" }: ModelPickerProps) {
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [cloudModels, setCloudModels] = useState<ModelInfo[]>([]);
  const [localStatus, setLocalStatus] = useState<Status>("loading");
  const [cloudStatus, setCloudStatus] = useState<Status>("offline");
  const [manualValue, setManualValue] = useState("");
  const [showManual, setShowManual] = useState(false);
  const manualRef = useRef<HTMLInputElement>(null);

  // Fetch local Ollama models
  useEffect(() => {
    let cancelled = false;
    setLocalStatus("loading");
    const fetch = async () => {
      try {
        const list = await listOllamaModels(host, "");
        if (!cancelled) { setLocalModels(list); setLocalStatus("online"); }
      } catch {
        if (!cancelled) { setLocalModels([]); setLocalStatus("offline"); }
      }
    };
    fetch();
    const interval = setInterval(fetch, 15000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [host]);

  // Fetch cloud Ollama models when key is present
  useEffect(() => {
    if (!ollamaApiKey) { setCloudModels([]); setCloudStatus("offline"); return; }
    let cancelled = false;
    setCloudStatus("loading");
    listOllamaModels("https://ollama.com", ollamaApiKey)
      .then((list) => { if (!cancelled) { setCloudModels(list); setCloudStatus("online"); } })
      .catch(() => { if (!cancelled) { setCloudModels([]); setCloudStatus("offline"); } });
    return () => { cancelled = true; };
  }, [ollamaApiKey]);

  // Auto-focus manual input when shown
  useEffect(() => {
    if (showManual) setTimeout(() => manualRef.current?.focus(), 50);
  }, [showManual]);

  const allCloudIds = cloudModels.map((m) => m.id);

  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7 max-w-[220px]">
            <span className="text-muted-foreground">{providerIcon(value, allCloudIds)}</span>
            <span className="truncate flex-1 text-left">{value || "Select model"}</span>
            <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end" className="w-64">

          {/* Ollama Local */}
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1.5">
            <Server size={11} />
            Ollama Local
            <StatusDot status={localStatus} />
          </DropdownMenuLabel>
          {localStatus === "loading" && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">Loading…</DropdownMenuItem>
          )}
          {localStatus !== "loading" && localModels.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">No local models found</DropdownMenuItem>
          )}
          {localModels.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="text-xs justify-between">
              <span className="truncate">{m.name}</span>
              {value === m.id && <Check size={11} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}

          {/* Ollama Cloud */}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1.5">
            <Cloud size={11} />
            Ollama Cloud
            <StatusDot status={cloudStatus} />
          </DropdownMenuLabel>
          {!ollamaApiKey && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">Add API key in Settings</DropdownMenuItem>
          )}
          {ollamaApiKey && cloudStatus === "loading" && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">Loading…</DropdownMenuItem>
          )}
          {ollamaApiKey && cloudStatus !== "loading" && cloudModels.length === 0 && (
            <DropdownMenuItem disabled className="text-xs text-muted-foreground">No cloud models found</DropdownMenuItem>
          )}
          {cloudModels.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="text-xs justify-between">
              <span className="truncate">{m.name}</span>
              {value === m.id && <Check size={11} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}

          {/* OpenAI */}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1.5">
            <Zap size={11} />
            OpenAI
          </DropdownMenuLabel>
          {OPENAI_MODELS.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="text-xs justify-between">
              <span>{m.name}</span>
              {value === m.id && <Check size={11} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}

          {/* Anthropic */}
          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground py-1.5">
            <Bot size={11} />
            Anthropic
          </DropdownMenuLabel>
          {ANTHROPIC_MODELS.map((m) => (
            <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="text-xs justify-between">
              <span>{m.name}</span>
              {value === m.id && <Check size={11} className="shrink-0 text-primary" />}
            </DropdownMenuItem>
          ))}

          {/* Manual entry */}
          <DropdownMenuSeparator />
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
                placeholder="Model ID… (Enter to apply)"
                className="h-7 text-xs"
              />
            </div>
          ) : (
            <DropdownMenuItem onClick={() => setShowManual(true)} className="text-xs text-muted-foreground">
              Enter model ID manually…
            </DropdownMenuItem>
          )}

        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
