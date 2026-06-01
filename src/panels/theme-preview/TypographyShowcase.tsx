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

      {/* Font families */}
      {fontRoles.length > 0 && (
        <div className="px-4 pb-3 space-y-2">
          <div className="text-[9px] text-muted-foreground/50 uppercase tracking-widest pb-1">
            Families
          </div>
          {fontRoles.map((role) => (
            <div
              key={role.var}
              className="rounded-md border border-border/30 p-3 bg-card/50 space-y-1"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[10px] text-muted-foreground/50">{role.label}</span>
                <span className="font-mono text-[9px] text-muted-foreground/40 truncate max-w-[160px]">
                  {tokens[role.var]}
                </span>
              </div>
              <div
                className="text-lg leading-tight text-foreground/85 truncate"
                style={{ fontFamily: `var(${role.var})` }}
              >
                {SPECIMEN}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Type scale as proportional cards */}
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">
        Scale
      </div>
      <div className="px-4 pb-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TYPE_SCALE.map((step) => (
          <div
            key={step.label}
            className="rounded-md border border-border/30 p-2.5 bg-card/50 flex flex-col justify-center"
            style={{ minHeight: `calc(${step.px} + ${parseInt(step.px) * 0.8}px)` }}
          >
            <span
              className="leading-tight text-foreground/80 mb-0.5 truncate"
              style={{ fontSize: step.px }}
            >
              Aa
            </span>
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[9px] text-muted-foreground/50">
                {step.label}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground/40">
                {step.px}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
