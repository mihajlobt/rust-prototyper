import { useState } from "react";
import { Icons } from "@/icons";

export function SaveComponentModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("LoginCard");
  const [tag, setTag] = useState("auth");
  const [desc, setDesc] = useState("A glassmorphic login card with email and password fields.");
  const [scope, setScope] = useState("project");
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Save Component</div>
            <div className="pi-sub">Add this component to your library for reuse</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: "auto", flex: 1 }}>
          <div>
            <div className="caps">Name</div>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <div className="caps">Tag</div>
            <input className="input" value={tag} onChange={(e) => setTag(e.target.value)} />
          </div>
          <div>
            <div className="caps">Description</div>
            <textarea className="textarea" rows={2} value={desc} onChange={(e) => setDesc(e.target.value)} />
          </div>
          <div>
            <div className="caps">Scope</div>
            <div className="seg">
              {[
                { id: "project", label: "Project", desc: "This workspace" },
                { id: "library", label: "Library", desc: "Across projects" },
              ].map((s) => (
                <button key={s.id} data-on={scope === s.id} onClick={() => setScope(s.id)}>{s.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: "1px solid var(--line-soft)", justifyContent: "flex-end", flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--acc" onClick={onClose}><Icons.save size={12} /> Save</button>
        </div>
      </div>
    </div>
  );
}
