import {
  LayoutGrid,
  Box,
  Palette,
  GitBranch,
  Play,
  BookOpen,
  Terminal,
  ChevronDown,
  Server,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState, useEffect } from "react";
import { listOllamaModels } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { SettingsModal } from "@/modals/SettingsModal";
import { ProjectManagerModal } from "@/modals/ProjectManagerModal";
import { ExportModal } from "@/modals/ExportModal";

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
}

export function Header({ activeView, onViewChange }: HeaderProps) {
  const { settings, setSettings } = useSettings();
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [hostStatus, setHostStatus] = useState<"online" | "offline">("offline");

  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const list = await listOllamaModels(settings.host);
        if (!cancelled) {
          setModels(list);
          setHostStatus("online");
        }
      } catch {
        if (!cancelled) setHostStatus("offline");
      }
    };
    ping();
    const interval = setInterval(ping, 10000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [settings.host]);

  return (
    <header className="h-12 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
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

      {/* Project Manager */}
      <ProjectManagerModal />

      {/* Export */}
      <ExportModal />

      {/* Host Status */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Server size={12} />
        <span
          className={[
            "w-1.5 h-1.5 rounded-full",
            hostStatus === "online" ? "bg-green-500" : "bg-red-500",
          ].join(" ")}
        />
        <span className="max-w-[120px] truncate">{settings.host}</span>
      </div>

      {/* Style Preset Picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <Palette size={12} />
            <span className="max-w-[100px] truncate">{settings.stylePreset || "Style"}</span>
            <ChevronDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {settings.styles.length === 0 && (
            <DropdownMenuItem disabled>No presets</DropdownMenuItem>
          )}
          {settings.styles.map((s) => (
            <DropdownMenuItem
              key={s.name}
              onClick={() => setSettings({ stylePreset: s.name })}
            >
              {s.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Model Picker */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <Zap size={12} />
            <span className="max-w-[140px] truncate">{settings.modelId || "Select model"}</span>
            <ChevronDown size={12} />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {models.length === 0 && (
            <DropdownMenuItem disabled>No models found</DropdownMenuItem>
          )}
          {models.map((m) => (
            <DropdownMenuItem
              key={m.id}
              onClick={() => setSettings({ modelId: m.id })}
            >
              {m.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Settings */}
      <SettingsModal />
    </header>
  );
}
