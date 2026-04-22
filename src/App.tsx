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

const views: Record<string, React.FC> = {
  screens: ScreensPanel,
  components: ComponentsPanel,
  themes: ThemesPanel,
  apis: APIsPanel,
  runner: RunnerPanel,
  library: LibraryPanel,
  workflows: WorkflowsView,
};

export default function App() {
  const { settings, setSettings, loaded } = useSettings();
  const [view, setView] = useState(settings.view || "screens");
  const [sidebarOpen, setSidebarOpen] = useState(true);

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

  const ActiveView = views[view] || ScreensPanel;

  const handleNavigateToItem = (_type: string, _name: string) => {
    // Switch to the appropriate view when navigating from Library
    const viewMap: Record<string, string> = {
      component: "components",
      theme: "themes",
      screen: "screens",
      api: "apis",
    };
    const targetView = viewMap[_type];
    if (targetView && targetView !== view) {
      setView(targetView);
      setSettings({ view: targetView });
    }
  };

  return (
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
              <SidebarRail onNavigateToItem={handleNavigateToItem} />
            </Allotment.Pane>
          )}
          <Allotment.Pane>
            {view === "library" ? (
              <LibraryPanel onNavigateToItem={handleNavigateToItem} />
            ) : (
              <ActiveView />
            )}
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}
