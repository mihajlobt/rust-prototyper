import { useState, useEffect } from "react";
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import { Header } from "./layout/Header";
import { SidebarRail } from "./layout/SidebarRail";
import { ScreensPanel } from "./panels/ScreensPanel";
import { ComponentsPanel } from "./panels/ComponentsPanel";
import { ThemesPanel } from "./panels/ThemesPanel";
import { APIsPanel } from "./panels/APIsPanel";
import { RunnerPanel } from "./panels/RunnerPanel";
import { LibraryPanel } from "./panels/LibraryPanel";
import { WorkflowsView } from "./workflows/WorkflowsView";
import { useSettings } from "./hooks/useSettings";
import { ToastProvider } from "./components/ToastProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { setupGlobalErrorHandlers } from "./lib/notifications";

export default function App() {
  const { settings, setSettings, loaded } = useSettings();

  useEffect(() => {
    setupGlobalErrorHandlers();
  }, []);
  const [view, setView] = useState(settings.view || "screens");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [pendingItem, setPendingItem] = useState<{ view: string; name: string } | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", settings.dark);
  }, [settings.dark]);

  useEffect(() => {
    document.documentElement.style.setProperty("--primary", settings.accent);
    document.documentElement.style.setProperty("--ring", settings.accent);
    document.documentElement.style.setProperty("--sidebar-primary", settings.accent);
  }, [settings.accent]);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("glow-subtle", settings.glow === "subtle");
    el.classList.toggle("glow-full", settings.glow === "full");
  }, [settings.glow]);

  useEffect(() => {
    document.documentElement.classList.toggle("amoled", settings.amoled);
  }, [settings.amoled]);

  if (!loaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-lg font-medium">Loading Prototyper…</div>
      </div>
    );
  }

  const itemFor = (v: string) => pendingItem?.view === v ? pendingItem.name : undefined;

  const handleNavigateToItem = (type: string, name: string) => {
    const viewMap: Record<string, string> = {
      screens: "screens",
      components: "components",
      themes: "themes",
      workflows: "workflows",
      apis: "apis",
    };
    const targetView = viewMap[type];
    if (!targetView) return;
    setPendingItem({ view: targetView, name });
    setView(targetView);
    setSettings({ view: targetView });
  };

  return (
    <>
      <ToastProvider />
      <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
        <Header
          activeView={view}
          onViewChange={(v) => { setView(v); setSettings({ view: v }); }}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
        />
        <div className="flex-1 overflow-hidden">
          <Allotment>
            {sidebarOpen && (
              <Allotment.Pane preferredSize={240} minSize={180} maxSize={320}>
                <SidebarRail onNavigateToItem={handleNavigateToItem} activeView={view} activeItem={pendingItem?.view === view ? pendingItem.name : undefined} />
              </Allotment.Pane>
            )}
            <Allotment.Pane>
              <ErrorBoundary>
                {view === "screens"    && <ScreensPanel    initialItem={itemFor("screens")} />}
                {view === "components" && <ComponentsPanel initialItem={itemFor("components")} />}
                {view === "themes"     && <ThemesPanel     initialItem={itemFor("themes")} />}
                {view === "workflows"  && <WorkflowsView   initialWorkflow={itemFor("workflows")} />}
                {view === "apis"       && <APIsPanel />}
                {view === "runner"     && <RunnerPanel />}
                {view === "library"    && <LibraryPanel onNavigateToItem={handleNavigateToItem} />}
              </ErrorBoundary>
            </Allotment.Pane>
          </Allotment>
        </div>
      </div>
    </>
  );
}
