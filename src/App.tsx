import { useState, useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Header } from "./layout/Header";
import { SidebarRail } from "./layout/SidebarRail";
import { CreatePanel } from "./panels/CreatePanel";
import { APIsPanel } from "./panels/APIsPanel";
import { RunnerPanel } from "./panels/RunnerPanel";
import { LibraryPanel } from "./panels/LibraryPanel";
import { AssetsPanel } from "./panels/AssetsPanel";
import { WorkflowsView } from "./workflows/WorkflowsView";
import { PlansPanel } from "./panels/PlansPanel";
import { useAppStore } from "./stores/appStore";
import { useProjectSettingsStore } from "./stores/projectSettingsStore";
import { Toaster } from "./components/ui/sonner";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { setupGlobalErrorHandlers } from "./lib/notifications";
import { useAllotmentLayout } from "./hooks/useAllotmentLayout";

export default function App() {
  const { settings, loaded } = useAppStore();
  const { ps, setProjectSettings, loaded: projectLoaded } = useProjectSettingsStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout("app", 2);

  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.dark);
  }, [settings.dark]);

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", settings.accent);
    document.documentElement.style.setProperty("--ring", settings.accent);
    document.documentElement.style.setProperty("--sidebar-primary", settings.accent);

    // Derive file-type icon colors from the accent hue using oklch color theory.
    // All icons share consistent lightness + chroma; only the hue angle varies.
    // Relationships: analogous ±30°, split-complementary ±60°, triadic ±120°, complementary 180°.
    const match = settings.accent.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/);
    if (match) {
      const hue = parseFloat(match[3]);
      // Brighter in dark mode so icons read clearly against dark backgrounds.
      const L = settings.dark ? 0.65 : 0.48;
      const C = 0.14;
      const set = (name: string, delta: number) =>
        document.documentElement.style.setProperty(
          name,
          `oklch(${L} ${C} ${((hue + delta) % 360 + 360) % 360})`,
        );

      set("--file-ts",     0);    // TypeScript/JS  — accent base
      set("--file-tsx",    30);   // TSX/JSX        — analogous +30°
      set("--file-css",   -30);   // CSS/SCSS       — analogous −30°
      set("--file-json",  180);   // JSON           — complementary (maximum contrast)
      set("--file-md",    120);   // Markdown       — triadic
      set("--file-img",  -120);   // Images/assets  — triadic −
      set("--file-html",   60);   // HTML           — split-complementary
      set("--file-config", 150);  // Config/YAML    — between triadic and complementary
    }
  }, [settings.accent, settings.dark]);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("glow-subtle", settings.glow === "subtle");
    el.classList.toggle("glow-full", settings.glow === "full");
  }, [settings.glow]);

  useEffect(() => {
    document.documentElement.classList.toggle("amoled", settings.amoled);
  }, [settings.amoled]);

  if (!loaded || !projectLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-lg font-medium">Loading Prototyper…</div>
      </div>
    );
  }

  return (
    <>
      <Toaster />
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
        <Header
          activeView={ps.activeView}
          onViewChange={(view) => setProjectSettings({ activeView: view })}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
        />
        <div className="flex-1 overflow-hidden">
          <Allotment ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes}>
            <Allotment.Pane visible={sidebarOpen} preferredSize={240} minSize={180} maxSize={320}>
              <SidebarRail />
            </Allotment.Pane>
            <Allotment.Pane>
              <ErrorBoundary>
                {ps.activeView === "create"     && <CreatePanel />}
                {ps.activeView === "plans"      && <PlansPanel />}
                <div style={{ display: ps.activeView === "workflows" ? "contents" : "none" }}>
                  <WorkflowsView />
                </div>
                {ps.activeView === "apis"       && <APIsPanel />}
                {ps.activeView === "assets"     && <AssetsPanel />}
                {ps.activeView === "runner"     && <RunnerPanel />}
                {ps.activeView === "library"    && <LibraryPanel />}
              </ErrorBoundary>
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
    </>
  );
}
