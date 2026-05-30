import {
  LayoutGrid,
  Box,
  Palette,
  GitBranch,
  Route,
  Play,
  BookOpen,
  Terminal,
  PanelLeft,
  Image,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { SettingsModal } from "@/modals/SettingsModal";
import { ProjectManagerModal } from "@/modals/ProjectManagerModal";
import { ExportModal } from "@/modals/ExportModal";
import { ModelPicker } from "@/components/ModelPicker";
import { ModelOptionsPopover } from "@/components/ModelOptionsPopover";
import { Button } from "@/components/ui/button";

const tabs = [
  { id: "screens", label: "Screens", icon: LayoutGrid },
  { id: "components", label: "Components", icon: Box },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "flows", label: "Flows", icon: Route },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "apis", label: "APIs", icon: Terminal },
  { id: "assets", label: "Assets", icon: Image },
  { id: "runner", label: "Runner", icon: Play },
  { id: "library", label: "Library", icon: BookOpen },
];

interface HeaderProps {
  activeView: string;
  onViewChange: (view: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function Header({ activeView, onViewChange, sidebarOpen, onToggleSidebar }: HeaderProps) {
  const { settings, setSettings } = useAppStore();

  return (
    <header className="panel-toolbar h-12 px-3 gap-2 bg-card">
      {/* Sidebar toggle */}
      <Button
        variant="ghost"
        size="icon"
        className={["h-8 w-8 shrink-0", sidebarOpen ? "text-foreground" : "text-muted-foreground"].join(" ")}
        onClick={onToggleSidebar}
        title="Toggle sidebar"
      >
        <PanelLeft size={16} />
      </Button>

      <div className="w-px h-5 bg-border" />

      {/* View Tabs */}
      <nav className="flex items-center gap-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.id === activeView;
          return (
            <button
              key={tab.id}
              onClick={() => onViewChange(tab.id)}
              className={[
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm font-medium transition-colors",
                active
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              ].join(" ")}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      <ProjectManagerModal />
      <ExportModal />
      <ModelPicker
        value={settings.modelId}
        onChange={({ modelId, provider }) => setSettings({ modelId, provider })}
        host={settings.host}
        ollamaApiKey={settings.apiKeys["ollama"] ?? ""}
      />
      <ModelOptionsPopover />
      <SettingsModal />
    </header>
  );
}
