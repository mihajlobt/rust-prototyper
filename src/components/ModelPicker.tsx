import { useState, useEffect } from "react";
import { Zap, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { listOllamaModels, type ModelInfo } from "@/lib/ipc";

interface ModelPickerProps {
  value: string;
  onChange: (model: string) => void;
  host: string;
}

export function ModelPicker({ value, onChange, host }: ModelPickerProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [hostStatus, setHostStatus] = useState<"online" | "offline">("offline");
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const fetchModels = async () => {
      setLoading(true);
      try {
        const list = await listOllamaModels(host);
        if (!cancelled) {
          setModels(list);
          setHostStatus("online");
        }
      } catch {
        if (!cancelled) {
          setModels([]);
          setHostStatus("offline");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchModels();
    const interval = setInterval(fetchModels, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [host]);

  const isNonOllamaModel = value.startsWith("gpt-") || value.startsWith("o1-") || value.startsWith("o3-") || value.startsWith("claude-");

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={[
          "w-1.5 h-1.5 rounded-full",
          hostStatus === "online" ? "bg-green-500" : loading ? "bg-yellow-500" : "bg-red-500",
        ].join(" ")}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <Zap size={12} />
            <span className="max-w-[140px] truncate">{value || "Select model"}</span>
            <ChevronDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {loading && (
            <DropdownMenuItem disabled>Loading models…</DropdownMenuItem>
          )}
          {!loading && models.length === 0 && (
            <DropdownMenuItem disabled>No models found</DropdownMenuItem>
          )}
          {models.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => onChange(m.id)}
            >
              {m.name}
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem
            onClick={() => setShowManualInput(true)}
          >
            Enter model manually…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {(showManualInput || isNonOllamaModel || models.length === 0) && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Model ID (e.g. gpt-4, claude-3)"
          className="h-7 text-xs w-[160px]"
        />
      )}
    </div>
  );
}