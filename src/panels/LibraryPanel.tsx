import { useState } from "react";
import { Icons } from "@/icons";
import { LIB_COMPONENTS, LIB_THEMES, LIB_SCREENS, LIB_APIS } from "@/data";

export function LibraryPanel() {
  const [tab, setTab] = useState("components");
  const data = tab === "components" ? LIB_COMPONENTS : tab === "themes" ? LIB_THEMES : tab === "screens" ? LIB_SCREENS : LIB_APIS;
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">Library</div>
          <div className="view-sub">Everything you've saved — components, themes, screens, APIs — reusable across projects.</div>
        </div>
        <div className="row gap-2">
          <div className="seg">
            {["components", "themes", "screens", "apis"].map((t) => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <div style={{ position: "relative" }}>
            <Icons.search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--fg-mute)" }} />
            <input className="input" placeholder="Search…" style={{ paddingLeft: 26, width: 220 }} />
          </div>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
        <div className="grid-4">
          {data.map((x) => (
            <div key={x.id} className="card lib-card">
              <div className="lib-thumb" style={{ background: tab === "themes" ? `linear-gradient(135deg, ${(x as typeof LIB_THEMES[number]).swatches?.[0]}, ${(x as typeof LIB_THEMES[number]).swatches?.[1]})` : "var(--n-2)" }}>
                {tab === "components" && <Icons.cube size={24} />}
                {tab === "screens" && <Icons.grid size={24} />}
                {tab === "apis" && <Icons.send size={24} />}
                {tab === "themes" && <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{(x as typeof LIB_THEMES[number]).name}</span>}
              </div>
              <div style={{ padding: 10 }}>
                <div className="row gap-2">
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{(x as any).name}</div>
                  <span className="pill mono" style={{ marginLeft: "auto", fontSize: 9 }}>{(x as any).tag || (x as any).cat || (x as any).kind || "—"}</span>
                </div>
                <div style={{ fontSize: 10, color: "var(--fg-mute)", marginTop: 2 }}>{(x as any).updated ? `Updated ${(x as any).updated}` : (x as any).desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
