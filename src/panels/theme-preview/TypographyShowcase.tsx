import { parseTokenBlock } from "./ThemeScopedStyle";

const TYPE_SCALE = [
  { label: "xs", px: "12px", tw: "0.75rem" },
  { label: "sm", px: "14px", tw: "0.875rem" },
  { label: "base", px: "16px", tw: "1rem" },
  { label: "lg", px: "18px", tw: "1.125rem" },
  { label: "xl", px: "20px", tw: "1.25rem" },
  { label: "2xl", px: "24px", tw: "1.5rem" },
  { label: "3xl", px: "30px", tw: "1.875rem" },
  { label: "4xl", px: "36px", tw: "2.25rem" },
];

const SPECIMEN = "The quick brown fox";

interface TypographyShowcaseProps {
  css: string;
}

export function TypographyShowcase({ css }: TypographyShowcaseProps) {
  const tokens = parseTokenBlock(css, ":root");

  const fontRoles = [
    { label: "Sans", var: "--font-sans" },
    { label: "Mono", var: "--font-mono" },
    { label: "Serif", var: "--font-serif" },
    { label: "Display", var: "--font-display" },
  ].filter((r) => tokens[r.var]);

  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Typography
      </h3>

      {/* Font families — only show if theme defines them */}
      {fontRoles.length > 0 && (
        <div className="px-4 pb-3 space-y-1.5">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest pb-1">Families</div>
          {fontRoles.map((role) => (
            <div key={role.var} className="flex items-baseline gap-3">
              <span className="text-[10px] text-muted-foreground/50 w-14 shrink-0">{role.label}</span>
              <span
                className="text-[13px] text-foreground/80 truncate"
                style={{ fontFamily: `var(${role.var})` }}
              >
                {SPECIMEN}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/40 shrink-0 truncate max-w-[160px]">
                {tokens[role.var]}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Type scale */}
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">Scale</div>
      <div className="divide-y divide-border/30">
        {TYPE_SCALE.map((step) => (
          <div
            key={step.label}
            className="flex items-center gap-3 px-4 py-1 hover:bg-foreground/[0.03] transition-colors"
          >
            <span className="font-mono text-[10px] text-muted-foreground/50 w-8 shrink-0">{step.label}</span>
            <span
              className="flex-1 truncate leading-tight text-foreground/75"
              style={{ fontSize: step.px }}
            >
              {SPECIMEN}
            </span>
            <span className="font-mono text-[10px] text-muted-foreground/40 shrink-0">{step.px}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
