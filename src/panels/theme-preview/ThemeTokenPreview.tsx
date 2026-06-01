import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { rescopeThemeCss } from "./ThemeScopedStyle";
import { ColorSwatchGrid } from "./ColorSwatchGrid";
import { TypographyShowcase } from "./TypographyShowcase";
import { SpacingVisualizer } from "./SpacingVisualizer";
import { MotionDemos } from "./MotionDemos";
import { ComponentGallery } from "./ComponentGallery";
import { Separator } from "@/components/ui/separator";

interface ThemeTokenPreviewProps {
  css: string;
  isDark: boolean;
  viewMode: "preview" | "gallery";
}

export function ThemeTokenPreview({ css, isDark, viewMode }: ThemeTokenPreviewProps) {
  const [ready, setReady] = useState(false);

  // Inject rescoped theme CSS into document.head; clean up on unmount or css change.
  // ComponentGallery defers render until ready so Tailwind class resolution is correct.
  useEffect(() => {
    if (!css) { setReady(false); return; }
    const tag = document.createElement("style");
    tag.setAttribute("data-theme-preview", "true");
    tag.textContent = rescopeThemeCss(css);
    document.head.appendChild(tag);
    setReady(true);
    return () => { tag.remove(); setReady(false); };
  }, [css]);

  if (!css) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-center px-6">
        <p className="text-sm text-muted-foreground">No theme loaded.</p>
        <p className="text-xs text-muted-foreground/50">Generate or select a theme to see the preview.</p>
      </div>
    );
  }

  if (!ready) {
    return <div className="flex items-center justify-center h-full text-xs text-muted-foreground/40">Loading…</div>;
  }

  return (
    <div className={cn("theme-preview-scope h-full overflow-auto", isDark && "dark")}>
      <div className="bg-background text-foreground min-h-full">
        {viewMode === "gallery" ? (
          <ComponentGallery />
        ) : (
          <div className="divide-y divide-border/40">
            <ColorSwatchGrid css={css} isDark={isDark} />
            <Separator className="opacity-30" />
            <TypographyShowcase css={css} />
            <Separator className="opacity-30" />
            {/* Spacing & Shapes in a two-column layout */}
            <div className="grid grid-cols-2 divide-x divide-border/30">
              <div>
                <SpacingVisualizer />
                {/* Radii moved from ShapeTokens into left column */}
                <RadiiSection />
              </div>
              <div>
                <ShadowSection />
                <MotionDemos />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inline radii / shadow sub-sections extracted from ShapeTokens ──────────────

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

function RadiiSection() {
  return (
    <div>
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">
        Radius
      </div>
      <div className="flex items-end gap-4 px-4 pb-4">
        {RADII.map((r) => (
          <div key={r.label} className="flex flex-col items-center gap-1.5">
            <div className={`w-8 h-8 border border-border bg-muted/50 ${r.cls}`} />
            <span className="font-mono text-[9px] text-muted-foreground/50">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ShadowSection() {
  return (
    <div>
      <div className="px-4 pb-1 text-[9px] text-muted-foreground/50 uppercase tracking-widest">
        Shadow
      </div>
      <div className="flex items-end gap-5 px-4 pb-4">
        {SHADOWS.map((s) => (
          <div key={s.label} className="flex flex-col items-center gap-2">
            <div className={`w-10 h-10 rounded-md bg-card border border-border/30 ${s.cls}`} />
            <span className="font-mono text-[9px] text-muted-foreground/50">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
