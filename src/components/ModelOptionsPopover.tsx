import { Settings2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useSettings } from "@/hooks/useSettings";
import type { OllamaModelOptions } from "@/stores/appStore";

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

function isOllamaProvider(provider: string): boolean {
  return provider.startsWith("ollama");
}

export function ModelOptionsPopover() {
  const { settings, setSettings } = useSettings();

  if (!isOllamaProvider(settings.provider)) return null;

  const opts = settings.modelOptions ?? {};

  const set = (key: keyof OllamaModelOptions, raw: string) => {
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

  const hasAny = Object.keys(opts).some(
    (k) => opts[k as keyof OllamaModelOptions] !== undefined
  );

  const resetAll = () => setSettings({ modelOptions: {} });

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

      <PopoverContent align="end" className="w-72 p-3 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold">Model Options</p>
          {hasAny && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={resetAll}>
              <RotateCcw size={10} />
              Reset all
            </Button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          {FIELDS.map(({ key, label, hint, step, min, max }) => {
            const val = opts[key];
            return (
              <div key={key} className="space-y-1">
                <div className="flex items-baseline justify-between">
                  <Label className="text-[10px] font-medium leading-none">{label}</Label>
                  <span className="text-[9px] text-muted-foreground">{hint}</span>
                </div>
                <Input
                  type="number"
                  step={step}
                  min={min}
                  {...(max !== undefined ? { max } : {})}
                  value={val ?? ""}
                  placeholder="—"
                  onChange={(e) => set(key, e.target.value)}
                  className="h-7 text-xs px-2"
                />
              </div>
            );
          })}
        </div>

        <p className="text-[9px] text-muted-foreground leading-relaxed">
          Empty fields use Ollama defaults. Only applies to Ollama models.
        </p>
      </PopoverContent>
    </Popover>
  );
}
