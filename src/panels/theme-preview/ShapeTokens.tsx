// Radii and shadows — rendered using Tailwind classes so they resolve from the theme scope

const RADII = [
  { label: "sm", cls: "rounded-sm" },
  { label: "md", cls: "rounded-md" },
  { label: "lg", cls: "rounded-lg" },
  { label: "xl", cls: "rounded-xl" },
  { label: "full", cls: "rounded-full" },
];

const SHADOWS = [
  { label: "sm", cls: "shadow-sm" },
  { label: "md", cls: "shadow-md" },
  { label: "lg", cls: "shadow-lg" },
  { label: "xl", cls: "shadow-xl" },
];

export function ShapeTokens() {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Shapes
      </h3>

      {/* Radii */}
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">Radius</div>
      <div className="flex items-end gap-4 px-4 pb-4">
        {RADII.map((r) => (
          <div key={r.label} className="flex flex-col items-center gap-1.5">
            <div
              className={`w-8 h-8 border border-border bg-muted/50 ${r.cls}`}
            />
            <span className="font-mono text-[9px] text-muted-foreground/50">{r.label}</span>
          </div>
        ))}
      </div>

      {/* Shadows */}
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">Shadow</div>
      <div className="flex items-end gap-5 px-4 pb-4">
        {SHADOWS.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-2">
            <div
              className={`w-10 h-10 rounded-md bg-card border border-border/30 ${s.cls}`}
            />
            <span className="font-mono text-[9px] text-muted-foreground/50">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
