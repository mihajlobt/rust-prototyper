// Standard Tailwind spacing ramp — these are design system values, not CSS vars
const SPACING = [
  { label: "0.5", px: 2 },
  { label: "1", px: 4 },
  { label: "1.5", px: 6 },
  { label: "2", px: 8 },
  { label: "3", px: 12 },
  { label: "4", px: 16 },
  { label: "5", px: 20 },
  { label: "6", px: 24 },
  { label: "8", px: 32 },
  { label: "10", px: 40 },
  { label: "12", px: 48 },
  { label: "16", px: 64 },
];

const MAX_PX = SPACING[SPACING.length - 1].px;
const BAR_MAX_W = 140; // px

export function SpacingVisualizer() {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Spacing
      </h3>
      <div className="space-y-0.5 pb-2">
        {SPACING.map((step) => (
          <div
            key={step.label}
            className="flex items-center gap-3 px-4 py-0.5 hover:bg-foreground/[0.03] transition-colors"
          >
            <span className="font-mono text-[10px] text-muted-foreground/50 w-8 shrink-0 text-right">
              {step.label}
            </span>
            <div
              className="h-[10px] rounded-sm bg-primary/25 shrink-0"
              style={{ width: Math.max(2, (step.px / MAX_PX) * BAR_MAX_W) }}
            />
            <span className="font-mono text-[10px] text-muted-foreground/40">{step.px}px</span>
          </div>
        ))}
      </div>
    </div>
  );
}
