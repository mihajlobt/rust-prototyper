import { useState, useEffect, useCallback } from "react";
import { Settings2, RotateCcw, Trash2, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/hooks/useSettings";
import { saveModelPresets, loadModelPresets, type ModelPreset } from "@/lib/ipc";
import type { OllamaModelOptions } from "@/stores/appStore";
import { notify } from "@/hooks/useToast";

// ─── Field definitions ────────────────────────────────────────────────────────

interface FieldDef {
  key: keyof OllamaModelOptions;
  label: string;
  hint: string;
  step: number;
  min: number;
  max?: number;
}

const FIELDS: FieldDef[] = [
  { key: "temperature",   label: "Temperature",     hint: "def 0.8",  step: 0.05, min: 0,   max: 2   },
  { key: "topK",          label: "Top K",           hint: "def 40",   step: 1,    min: 1,   max: 200 },
  { key: "topP",          label: "Top P",           hint: "def 0.9",  step: 0.05, min: 0,   max: 1   },
  { key: "numCtx",        label: "Context Window",  hint: "def 2048", step: 512,  min: 128           },
  { key: "numPredict",    label: "Max Tokens",      hint: "def −1 ∞", step: 64,   min: -2            },
  { key: "repeatPenalty", label: "Repeat Penalty",  hint: "def 1.1",  step: 0.05, min: 0,   max: 2   },
  { key: "repeatLastN",   label: "Repeat Look-back",hint: "def 64",   step: 8,    min: -1            },
  { key: "seed",          label: "Seed",            hint: "def 0 rnd",step: 1,    min: -1            },
  { key: "mirostat",      label: "Mirostat",        hint: "0/1/2",    step: 1,    min: 0,   max: 2   },
  { key: "mirostatTau",   label: "Mirostat τ",      hint: "def 5.0",  step: 0.1,  min: 0             },
  { key: "mirostatEta",   label: "Mirostat η",      hint: "def 0.1",  step: 0.01, min: 0             },
  { key: "tfsZ",          label: "TFS Z",           hint: "def 1.0",  step: 0.05, min: 0             },
];

// ─── Built-in presets (sourced from Ollama docs + Gemma 4 official docs) ─────

const BUILT_IN_PRESETS: ModelPreset[] = [
  {
    id: "balanced",
    name: "Balanced",
    description: "General-purpose defaults. Good starting point for most tasks.",
    options: { temperature: 0.8, topK: 40, topP: 0.9, repeatPenalty: 1.1 },
  },
  {
    id: "coding",
    name: "Coding",
    description: "Low temp for deterministic, correct code. Higher max tokens.",
    options: { temperature: 0.2, topK: 40, topP: 0.95, repeatPenalty: 1.1, numPredict: 4096 },
  },
  {
    id: "creative",
    name: "Creative Writing",
    description: "High temp for varied, imaginative, surprising outputs.",
    options: { temperature: 1.0, topK: 60, topP: 0.95 },
  },
  {
    id: "precise",
    name: "Precise / Factual",
    description: "Very low temp for factual Q&A. Minimal hallucination.",
    options: { temperature: 0.1, topK: 20, topP: 0.85, repeatPenalty: 1.1 },
  },
  {
    id: "analytical",
    name: "Analytical",
    description: "Balanced settings for reasoning, summaries, and analysis.",
    options: { temperature: 0.7, topK: 40, topP: 0.9, repeatPenalty: 1.05 },
  },
  {
    id: "rag",
    name: "RAG / Retrieval",
    description: "Low temp reduces hallucination in document retrieval contexts.",
    options: { temperature: 0.3, topK: 20, topP: 0.8, repeatPenalty: 1.1 },
  },
  {
    id: "brainstorm",
    name: "Brainstorming",
    description: "High temp + wide nucleus for maximum idea diversity.",
    options: { temperature: 1.2, topK: 80, topP: 0.98 },
  },
  {
    id: "gemma4",
    name: "Gemma 4 27B",
    description: "Google-recommended defaults for Gemma 4 general tasks. (top_k 65 per Unsloth/Google docs)",
    options: { temperature: 1.0, topK: 65, topP: 0.95 },
  },
  {
    id: "gemma4-coding",
    name: "Gemma 4 27B — Coding",
    description: "Gemma 4 coding: temp 1.5 outperforms lower values. Counterintuitive but tested.",
    options: { temperature: 1.5, topK: 65, topP: 0.95 },
  },
  {
    id: "long-context",
    name: "Long Context",
    description: "32K context window for large documents, codebases, and transcripts.",
    options: { temperature: 0.7, topP: 0.9, numCtx: 32768 },
  },
  {
    id: "deterministic",
    name: "Deterministic",
    description: "Zero temperature + fixed seed for fully reproducible outputs.",
    options: { temperature: 0.0, seed: 42 },
  },
  {
    id: "mirostat2",
    name: "Mirostat 2",
    description: "Adaptive perplexity sampling. Balances coherence and diversity automatically.",
    options: { mirostat: 2, mirostatTau: 5.0, mirostatEta: 0.1, temperature: 0.8 },
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ModelOptionsPopover() {
  const { settings, setSettings } = useSettings();
  const [userPresets, setUserPresets] = useState<ModelPreset[]>([]);
  const [saveName, setSaveName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const opts = settings.modelOptions ?? {};
  const hasAny = Object.keys(opts).some((k) => opts[k as keyof OllamaModelOptions] !== undefined);

  // Load user presets from disk on mount
  useEffect(() => {
    loadModelPresets()
      .then(setUserPresets)
      .catch(() => {});
  }, []);

  const persistUserPresets = useCallback(async (next: ModelPreset[]) => {
    setUserPresets(next);
    try {
      await saveModelPresets(next);
    } catch (e) {
      notify.error("Failed to save presets", e instanceof Error ? e.message : String(e));
    }
  }, []);

  const setField = (key: keyof OllamaModelOptions, raw: string) => {
    setActivePresetId(null);
    if (raw === "") {
      const next = { ...opts };
      delete next[key];
      setSettings({ modelOptions: next });
      return;
    }
    const val = parseFloat(raw);
    if (isNaN(val)) return;
    setSettings({ modelOptions: { ...opts, [key]: val } });
  };

  const applyPreset = (preset: ModelPreset) => {
    setSettings({ modelOptions: preset.options });
    setActivePresetId(preset.id);
  };

  const resetAll = () => {
    setSettings({ modelOptions: {} });
    setActivePresetId(null);
  };

  const saveCurrentAsPreset = async () => {
    const name = saveName.trim();
    if (!name || !hasAny) return;
    const id = `user-${Date.now()}`;
    const preset: ModelPreset = { id, name, description: "Custom preset", options: { ...opts } };
    await persistUserPresets([...userPresets, preset]);
    setSaveName("");
  };

  const deleteUserPreset = async (id: string) => {
    const next = userPresets.filter((p) => p.id !== id);
    await persistUserPresets(next);
    if (activePresetId === id) setActivePresetId(null);
  };

  if (!settings.provider.startsWith("ollama")) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant={hasAny ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Model options"
        >
          <Settings2 size={13} />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[560px] p-0 overflow-hidden">
        <div className="flex h-[420px]">

          {/* ── Left: parameter form ── */}
          <div className="flex flex-col w-[252px] shrink-0 border-r border-border">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <p className="text-xs font-semibold">Parameters</p>
              {hasAny && (
                <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={resetAll}>
                  <RotateCcw size={10} />
                  Reset
                </Button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-3">
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {FIELDS.map(({ key, label, hint, step, min, max }) => (
                  <div key={key} className="space-y-0.5">
                    <div className="flex items-baseline justify-between">
                      <Label className="text-[10px] font-medium leading-none">{label}</Label>
                      <span className="text-[9px] text-muted-foreground">{hint}</span>
                    </div>
                    <Input
                      type="number"
                      step={step}
                      min={min}
                      {...(max !== undefined ? { max } : {})}
                      value={opts[key] ?? ""}
                      placeholder="—"
                      onChange={(e) => setField(key, e.target.value)}
                      className="h-7 text-xs px-2"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="px-3 py-2 border-t border-border">
              <p className="text-[9px] text-muted-foreground">Empty = Ollama default</p>
            </div>
          </div>

          {/* ── Right: presets list ── */}
          <div className="flex flex-col flex-1 min-w-0">
            <div className="px-3 py-2 border-b border-border">
              <p className="text-xs font-semibold">Presets</p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {/* Built-in presets */}
              <div className="px-2 pt-2 pb-1">
                <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-1">Built-in</p>
                {BUILT_IN_PRESETS.map((preset) => (
                  <PresetRow
                    key={preset.id}
                    preset={preset}
                    active={activePresetId === preset.id}
                    onApply={() => applyPreset(preset)}
                  />
                ))}
              </div>

              {/* User presets */}
              {userPresets.length > 0 && (
                <div className="px-2 pt-1 pb-2">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground px-1 mb-1">Saved</p>
                  {userPresets.map((preset) => (
                    <PresetRow
                      key={preset.id}
                      preset={preset}
                      active={activePresetId === preset.id}
                      onApply={() => applyPreset(preset)}
                      onDelete={() => deleteUserPreset(preset.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Save current as preset */}
            <div className="px-3 py-2 border-t border-border flex items-center gap-2">
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder="Save current as…"
                className="h-7 text-xs flex-1"
                onKeyDown={(e) => { if (e.key === "Enter") saveCurrentAsPreset(); }}
              />
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0"
                disabled={!saveName.trim() || !hasAny}
                onClick={saveCurrentAsPreset}
                title="Save preset"
              >
                <Plus size={12} />
              </Button>
            </div>
          </div>

        </div>
      </PopoverContent>
    </Popover>
  );
}

function PresetRow({
  preset,
  active,
  onApply,
  onDelete,
}: {
  preset: ModelPreset;
  active: boolean;
  onApply: () => void;
  onDelete?: () => void;
}) {
  return (
    <button
      onClick={onApply}
      className={[
        "w-full text-left px-2 py-1.5 rounded-md transition-colors group flex items-start gap-1.5",
        active ? "bg-accent/20" : "hover:bg-muted/60",
      ].join(" ")}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium leading-tight truncate">{preset.name}</span>
          {active && <Check size={9} className="text-primary shrink-0" />}
        </div>
        <p className="text-[9px] text-muted-foreground leading-snug mt-0.5 line-clamp-2">{preset.description}</p>
      </div>
      {onDelete && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-muted-foreground hover:text-destructive transition-all shrink-0 mt-0.5"
        >
          <Trash2 size={10} />
        </button>
      )}
    </button>
  );
}
