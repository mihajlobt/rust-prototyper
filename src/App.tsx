import { useState } from "react";
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

  if (!loaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-background text-foreground">
        <div className="animate-pulse text-lg font-medium">Loading Prototyper…</div>
      </div>
    );
  }

  const ActiveView = views[view] || ScreensPanel;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-background text-foreground">
      <Header
        activeView={view}
        onViewChange={(v) => {
          setView(v);
          setSettings({ view: v });
        }}
      />
      <div className="flex-1 overflow-hidden">
        <Allotment>
          <Allotment.Pane preferredSize={240} minSize={180} maxSize={320}>
            <SidebarRail activeView={view} onViewChange={setView} />
          </Allotment.Pane>
          <Allotment.Pane>
            <ActiveView />
          </Allotment.Pane>
        </Allotment>
      </div>
    </div>
  );
}
