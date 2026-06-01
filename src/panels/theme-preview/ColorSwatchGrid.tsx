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
      { var: "--card-foreground", label: "Card foreground" },
      { var: "--popover", label: "Popover" },
      { var: "--popover-foreground", label: "Popover foreground" },
    ],
  },
  {
    label: "Interactive",
    tokens: [
      { var: "--primary", label: "Primary" },
      { var: "--primary-foreground", label: "Primary foreground" },
      { var: "--secondary", label: "Secondary" },
      { var: "--secondary-foreground", label: "Secondary foreground" },
      { var: "--accent", label: "Accent" },
      { var: "--accent-foreground", label: "Accent foreground" },
      { var: "--destructive", label: "Destructive" },
      { var: "--destructive-foreground", label: "Destructive foreground" },
      { var: "--muted", label: "Muted" },
      { var: "--muted-foreground", label: "Muted foreground" },
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

function SwatchRow({ cssVar, value }: { cssVar: string; label: string; value: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard.writeText(`var(${cssVar})`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="group flex items-center gap-3 py-1 px-4 hover:bg-foreground/[0.03] transition-colors">
      <div
        className="h-[18px] w-[18px] shrink-0 rounded border border-black/10 dark:border-white/10"
        style={{ backgroundColor: `var(${cssVar})` }}
      />
      <span className="font-mono text-[10px] text-muted-foreground w-44 shrink-0 truncate">{cssVar}</span>
      <span className="flex-1 font-mono text-[10px] text-muted-foreground/50 truncate">{value || "—"}</span>
      <button
        onClick={copy}
        className={cn(
          "shrink-0 opacity-0 group-hover:opacity-100 transition-all",
          copied ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
        )}
        title={`Copy var(${cssVar})`}
      >
        {copied ? <Check size={10} /> : <Copy size={10} />}
      </button>
    </div>
  );
}

interface ColorSwatchGridProps {
  css: string;
  isDark: boolean;
}

export function ColorSwatchGrid({ css, isDark }: ColorSwatchGridProps) {
  const lightTokens = parseTokenBlock(css, ":root");
  const darkTokens = parseTokenBlock(css, ".dark");
  const tokens = isDark && Object.keys(darkTokens).length > 0
    ? { ...lightTokens, ...darkTokens }
    : lightTokens;

  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Colors
      </h3>
      {COLOR_GROUPS.map((group, gi) => (
        <div key={group.label} className={gi > 0 ? "mt-1" : ""}>
          <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">
            {group.label}
          </div>
          {group.tokens.map((t) => (
            <SwatchRow
              key={t.var}
              cssVar={t.var}
              label={t.label}
              value={tokens[t.var] ?? ""}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
