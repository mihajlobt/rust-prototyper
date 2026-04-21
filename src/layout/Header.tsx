import { useState } from "react";
import { Icons } from "@/icons";
import { ModelPicker } from "@/prompt-inspector";
import { StylePresetPicker } from "@/components/StylePresetPicker";
import { HostPicker } from "@/components/HostPicker";
import { ProjectManagerModal } from "@/modals/ProjectManagerModal";
import { cx } from "@/data";

const tabs = [
  { id: "screens",    label: "Screens",    icon: "grid" },
  { id: "components", label: "Components", icon: "cube" },
  { id: "themes",     label: "Themes",     icon: "palette" },
  { id: "workflows",  label: "Workflows",  icon: "flow" },
  { id: "apis",       label: "APIs",       icon: "send" },
  { id: "library",    label: "Library",    icon: "folder" },
  { id: "runner",     label: "Run",        icon: "play" },
];

export function Header({
  activeView, setActiveView, project, setProject, openSettings, modelId, setModelId, stylePreset, setStylePreset,
}: {
  activeView: string;
  setActiveView: (v: string) => void;
  project: string;
  setProject: (v: string) => void;
  openSettings: () => void;
  modelId: string;
  setModelId: (v: string) => void;
  stylePreset: string;
  setStylePreset: (v: string) => void;
}) {
  const [showProjectManager, setShowProjectManager] = useState(false);
  return (
    <div className="hdr">
      <div className="row gap-3" style={{ paddingLeft: 12 }}>
        <div className="hdr-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M4 6 L12 2 L20 6 L20 18 L12 22 L4 18 Z" stroke="var(--acc)" strokeWidth="1.5" />
            <path d="M4 6 L12 10 L20 6 M12 10 L12 22" stroke="var(--acc)" strokeWidth="1.5" opacity=".6" />
          </svg>
        </div>
        <div className="hdr-wordmark">Prototyper</div>
      </div>
      <div className="hdr-tabs">
        {tabs.map((t) => {
          const Ic = Icons[t.icon as keyof typeof Icons];
          return (
            <button key={t.id} className={cx("hdr-tab", activeView === t.id && "hdr-tab--on")} onClick={() => setActiveView(t.id)}>
              <Ic size={12} /> {t.label}
            </button>
          );
        })}
      </div>
      <div className="row gap-3" style={{ marginLeft: "auto", paddingRight: 10 }}>
        <div className="pill" style={{ cursor: "pointer" }} onClick={() => setShowProjectManager(true)}><Icons.folder size={11} /> {project}</div>
        <HostPicker />
        <ModelPicker value={modelId} onChange={setModelId} />
        <StylePresetPicker value={stylePreset} onChange={setStylePreset} />
        <button className="icon-btn" onClick={openSettings} title="Settings"><Icons.cog size={14} /></button>
      </div>
      <ProjectManagerModal open={showProjectManager} onClose={() => setShowProjectManager(false)} project={project} setProject={setProject} />
    </div>
  );
}
