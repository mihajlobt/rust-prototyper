import { useState } from "react";
import { cn } from "@/lib/utils";

const DURATIONS = [
  { label: "Fast", ms: 120, desc: "hover, color, border" },
  { label: "Normal", ms: 180, desc: "drawer, panel, reorder" },
  { label: "Slow", ms: 320, desc: "page, overlay" },
];

function MotionRow({ label, ms, desc }: { label: string; ms: number; desc: string }) {
  const [active, setActive] = useState(false);

  function trigger() {
    if (active) return;
    setActive(true);
    setTimeout(() => setActive(false), ms + 80);
  }

  return (
    <div className="flex items-center gap-4 px-4 py-2 hover:bg-foreground/[0.03] transition-colors group">
      <span className="font-mono text-[10px] text-muted-foreground/50 w-14 shrink-0">{ms}ms</span>

      {/* Animated track */}
      <div className="flex-1 h-[3px] rounded-full bg-border overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            active ? "w-full" : "w-0"
          )}
          style={{
            transition: active
              ? `width ${ms}ms cubic-bezier(0.16, 1, 0.3, 1)`
              : "none",
          }}
        />
      </div>

      <span className="text-[10px] text-muted-foreground/50 w-20 shrink-0">{label}</span>
      <span className="text-[10px] text-muted-foreground/30 hidden group-hover:block flex-1 truncate">{desc}</span>

      {/* Trigger — only on explicit click, never on mount */}
      <button
        onClick={trigger}
        className="shrink-0 opacity-0 group-hover:opacity-100 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-opacity"
      >
        play
      </button>
    </div>
  );
}

export function MotionDemos() {
  return (
    <div>
      <h3 className="text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground px-4 pt-3 pb-2">
        Motion
      </h3>
      <div className="pb-2">
        {DURATIONS.map((d) => (
          <MotionRow key={d.ms} {...d} />
        ))}
      </div>
    </div>
  );
}
