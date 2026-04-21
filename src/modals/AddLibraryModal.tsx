import { useState } from "react";
import { Icons } from "@/icons";

export function AddLibraryModal({ open, onClose, onAdd }: { open: boolean; onClose: () => void; onAdd?: (lib: string) => void }) {
  const [custom, setCustom] = useState("");
  const presets = ["framer-motion", "@radix-ui/react-dialog", "clsx", "class-variance-authority", "tailwind-merge", "date-fns", "zod"];
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div className="card" style={{ width: 360, display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Add Library</div>
            <div className="pi-sub">Include an extra dependency in the generated component</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-3" style={{ overflow: "auto", flex: 1 }}>
          <div className="caps">Common</div>
          <div className="row gap-1" style={{ flexWrap: "wrap" }}>
            {presets.map((p) => (
              <button key={p} className="tag" style={{ cursor: "pointer" }} onClick={() => { onAdd?.(p); onClose(); }}>{p}</button>
            ))}
          </div>
          <div className="hair" style={{ margin: "2px 0" }} />
          <div className="caps">Custom</div>
          <div className="row gap-2">
            <input className="input mono" placeholder="npm-package-name" value={custom} onChange={(e) => setCustom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && custom.trim() && (onAdd?.(custom.trim()), onClose())} style={{ flex: 1, fontSize: 12 }} />
            <button className="btn btn--acc" style={{ padding: "5px 10px", fontSize: 11 }} onClick={() => { if (custom.trim()) { onAdd?.(custom.trim()); onClose(); } }}>Add</button>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: "1px solid var(--line-soft)", justifyContent: "flex-end", flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
