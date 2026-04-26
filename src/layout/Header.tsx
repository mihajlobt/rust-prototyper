import {
  LayoutGrid,
  Box,
  Palette,
  GitBranch,
  Play,
  BookOpen,
  Terminal,
  PanelLeft,
  Server,
  Zap,
  Bot,
} from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { SettingsModal } from "@/modals/SettingsModal";
import { ProjectManagerModal } from "@/modals/ProjectManagerModal";
import { ExportModal } from "@/modals/ExportModal";
import { ModelPicker } from "@/components/ModelPicker";
import { Button } from "@/components/ui/button";
import type { Provider } from "@/lib/ipc";

const PROVIDERS: { id: Provider; label: string; icon: React.ReactNode }[] = [
  { id: "ollama", label: "Ollama", icon: <Server size={11} /> },
  { id: "openai", label: "OpenAI", icon: <Zap size={11} /> },
  { id: "claude", label: "Claude", icon: <Bot size={11} /> },
];

const tabs = [
  { id: "screens", label: "Screens", icon: LayoutGrid },
  { id: "components", label: "Components", icon: Box },
  { id: "themes", label: "Themes", icon: Palette },
  { id: "workflows", label: "Workflows", icon: GitBranch },
  { id: "apis", label: "APIs", icon: Terminal },
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
    <header className="h-12 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
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
      <div className="flex items-center gap-1 bg-muted/50 rounded-md px-1 py-0.5">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            onClick={() => setSettings({ provider: p.id })}
            className={[
              "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors",
              settings.provider === p.id
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
            title={p.label}
          >
            {p.icon}
            <span className="hidden sm:inline">{p.label}</span>
          </button>
        ))}
      </div>
      <ModelPicker
        value={settings.modelId}
        onChange={(model) => setSettings({ modelId: model })}
        host={settings.host}
        ollamaApiKey={settings.apiKeys["ollama"] ?? ""}
        cloudModelIds={settings.ollamaCloudModels}
      />
      <SettingsModal />
    </header>
  );
}
