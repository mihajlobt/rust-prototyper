import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { rescopeThemeCss } from "./ThemeScopedStyle";
import { ColorSwatchGrid } from "./ColorSwatchGrid";
import { TypographyShowcase } from "./TypographyShowcase";
import { SpacingVisualizer } from "./SpacingVisualizer";
import { ShapeTokens } from "./ShapeTokens";
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
            <SpacingVisualizer />
            <Separator className="opacity-30" />
            <ShapeTokens />
            <Separator className="opacity-30" />
            <MotionDemos />
          </div>
        )}
      </div>
    </div>
  );
}
