import { useState } from "react";
import { Icons } from "@/icons";

export function ComponentExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState("tsx");
  const [include, setInclude] = useState({ types: true, storybook: false, test: false, css: true });
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div className="card" style={{ width: 480, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Export Component</div>
            <div className="pi-sub">Package the generated component for use in your project</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-4" style={{ overflow: "auto", flex: 1 }}>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Format</div>
            <div className="seg" style={{ flexWrap: "wrap" }}>
              {[
                { id: "tsx", label: "React TSX" },
                { id: "jsx", label: "React JSX" },
                { id: "vue", label: "Vue SFC" },
                { id: "svelte", label: "Svelte" },
                { id: "webc", label: "Web Component" },
              ].map((f) => (
                <button key={f.id} data-on={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Include</div>
            <div className="col gap-2">
              {[
                { key: "types", label: "Type definitions", desc: "Props interface / type exports" },
                { key: "css", label: "Styles", desc: "Tailwind classes or CSS module" },
                { key: "storybook", label: "Storybook story", desc: "Default + variant stories" },
                { key: "test", label: "Unit test", desc: "Vitest + React Testing Library scaffold" },
              ].map((item) => (
                <label key={item.key} className="row gap-2" style={{ alignItems: "flex-start", padding: 8, borderRadius: 8, background: "var(--n-1)", border: "1px solid var(--line-soft)", cursor: "pointer" }}>
                  <input type="checkbox" checked={include[item.key as keyof typeof include]} onChange={(e) => setInclude({ ...include, [item.key]: e.target.checked })} />
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 500 }}>{item.label}</div>
                    <div style={{ fontSize: 10, color: "var(--fg-mute)" }}>{item.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div className="hair" />
          <div className="col gap-2">
            <div className="caps">Output preview</div>
            <pre className="code-pane mono" style={{ fontSize: 11, padding: 10, borderRadius: 8, background: "var(--n-1)" }}>{format === "tsx"
              ? `export interface LoginCardProps {\n  onSignIn: (user: string) => void;\n}\n\nexport function LoginCard({ onSignIn }: LoginCardProps) {\n  return <div>…</div>;\n}`
              : "// component output"}</pre>
          </div>
        </div>
        <div className="pad-4 row gap-2" style={{ borderTop: "1px solid var(--line-soft)", justifyContent: "flex-end", flexShrink: 0 }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--acc"><Icons.file size={12} /> Export {format}</button>
        </div>
      </div>
    </div>
  );
}
