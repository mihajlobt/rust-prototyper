import { useState, useEffect } from "react";
import { Icons } from "@/icons";

interface Project {
  id: string;
  name: string;
  updated: string;
}

export function ProjectManagerModal({ open, onClose, project, setProject }: { open: boolean; onClose: () => void; project: string; setProject: (v: string) => void }) {
  const [projects, setProjects] = useState<Project[]>(() => {
    try {
      const saved = localStorage.getItem("pt.projects");
      if (saved) return JSON.parse(saved);
      return [
        { id: "default", name: "Default Project", updated: "Just now" },
        { id: "p2", name: "E-commerce App", updated: "2h ago" },
        { id: "p3", name: "Portfolio Site", updated: "1d ago" },
      ];
    } catch { return [{ id: "default", name: "Default Project", updated: "Just now" }]; }
  });
  const [draft, setDraft] = useState(project);

  useEffect(() => { localStorage.setItem("pt.projects", JSON.stringify(projects)); }, [projects]);
  useEffect(() => { setDraft(project); }, [project, open]);

  const saveCurrent = () => {
    setProject(draft);
    setProjects((ps) => {
      const exists = ps.find((p) => p.name === project);
      if (exists) {
        return ps.map((p) => p.name === project ? { ...p, name: draft, updated: "Just now" } : p);
      }
      return [{ id: "p" + Date.now(), name: draft, updated: "Just now" }, ...ps];
    });
  };

  const loadProject = (name: string) => { setProject(name); onClose(); };

  const deleteProject = (id: string, name: string) => {
    setProjects((ps) => ps.filter((p) => p.id !== id));
    if (name === project) { setProject("Default Project"); }
  };

  const createNew = () => {
    const name = "New Project";
    const id = "p" + Date.now();
    setProjects((ps) => [{ id, name, updated: "Just now" }, ...ps]);
    setProject(name);
    setDraft(name);
  };

  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxHeight: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Project Manager</div>
            <div className="pi-sub">Save, load and manage your prototypes</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: "auto", flex: 1 }}>
          <div className="row gap-2" style={{ alignItems: "center" }}>
            <div className="caps">Current</div>
            <input className="input" value={draft} onChange={(e) => setDraft(e.target.value)} style={{ flex: 1 }} />
            <button className="btn btn--acc" onClick={saveCurrent}><Icons.save size={12} /> Save</button>
          </div>
          <div className="hair" />
          <div className="row gap-2" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="caps">Projects</div>
            <button className="btn" onClick={createNew}><Icons.plus size={12} /> New</button>
          </div>
          <div className="col gap-1">
            {projects.map((p) => (
              <div key={p.id} className="row gap-2" style={{ padding: "8px 10px", borderRadius: 8, background: p.name === project ? "var(--acc-soft)" : "var(--n-1)", alignItems: "center", cursor: "pointer", transition: "background .12s" }} onClick={() => loadProject(p.name)}>
                <Icons.folder size={14} style={{ color: "var(--fg-mute)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: "var(--fg-mute)" }}>{p.updated}</div>
                </div>
                {p.name === project ? (
                  <span className="pill pill--acc" style={{ fontSize: 9 }}>active</span>
                ) : (
                  <button className="icon-btn" title="Delete" onClick={(e) => { e.stopPropagation(); deleteProject(p.id, p.name); }}><Icons.trash size={12} /></button>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: "1px solid var(--line-soft)", justifyContent: "flex-end", flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
