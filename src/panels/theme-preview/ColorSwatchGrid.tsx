import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseTokenBlock } from "./ThemeScopedStyle";
import { cn } from "@/lib/utils";

const COLOR_GROUPS: Array<{ label: string; tokens: Array<{ var: string; label: string }> }> = [
  {
    label: "Background",
    tokens: [
      { var: "--background", label: "Background" },
      { var: "--foreground", label: "Foreground" },
    ],
  },
  {
    label: "Surface",
    tokens: [
      { var: "--card", label: "Card" },
      { var: "--card-foreground", label: "Card fg" },
      { var: "--popover", label: "Popover" },
      { var: "--popover-foreground", label: "Popover fg" },
    ],
  },
  {
    label: "Interactive",
    tokens: [
      { var: "--primary", label: "Primary" },
      { var: "--primary-foreground", label: "Primary fg" },
      { var: "--secondary", label: "Secondary" },
      { var: "--secondary-foreground", label: "Secondary fg" },
      { var: "--accent", label: "Accent" },
      { var: "--accent-foreground", label: "Accent fg" },
      { var: "--destructive", label: "Destructive" },
      { var: "--destructive-foreground", label: "Destructive fg" },
      { var: "--muted", label: "Muted" },
      { var: "--muted-foreground", label: "Muted fg" },
    ],
  },
  {
    label: "Chrome",
    tokens: [
      { var: "--border", label: "Border" },
      { var: "--input", label: "Input" },
      { var: "--ring", label: "Ring" },
    ],
  },
];

function SwatchCard({ cssVar, label, value }: { cssVar: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(`var(${cssVar})`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <button
      onClick={copy}
      className={cn(
        "group/card flex flex-col rounded-md overflow-hidden border border-border/40",
        "hover:border-border transition-colors text-left w-full"
      )}
      title={`var(${cssVar}) — click to copy`}
    >
      <div
        className="h-14 w-full shrink-0 relative"
        style={{ backgroundColor: `var(${cssVar})` }}
      >
        <div className="absolute top-1 right-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
          {copied ? (
            <Check size={12} className="text-white drop-shadow" />
          ) : (
            <Copy size={12} className="text-white drop-shadow" />
          )}
        </div>
      </div>
      <div className="px-2 py-1.5 bg-card">
        <div className="font-mono text-[9px] text-muted-foreground truncate">{cssVar}</div>
        <div className="text-[10px] font-medium truncate">{label}</div>
        <div className="font-mono text-[9px] text-muted-foreground/50 truncate">{value || "—"}</div>
      </div>
    </button>
  );
}

interface ColorSwatchGridProps {
  css: string;
  isDark: boolean;
}

export function ColorSwatchGrid({ css, isDark }: ColorSwatchGridProps) {
  const lightTokens = parseTokenBlock(css, ":root");
  const darkTokens = parseTokenBlock(css, ".dark");
  const tokens =
    isDark && Object.keys(darkTokens).length > 0
      ? { ...lightTokens, ...darkTokens }
      : lightTokens;

  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Colors
      </h3>
      {COLOR_GROUPS.map((group) => (
        <div key={group.label} className="px-4 pb-3">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest pb-1.5">
            {group.label}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {group.tokens.map((t) => (
              <SwatchCard
                key={t.var}
                cssVar={t.var}
                label={t.label}
                value={tokens[t.var] ?? ""}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
