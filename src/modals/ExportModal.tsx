import { useState } from "react";
import { Icons } from "@/icons";

export function ExportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [format, setFormat] = useState("react-vite");
  const [routing, setRouting] = useState("react-router");
  const [include, setInclude] = useState({ apis: true, theme: true, components: true, tests: false });
  if (!open) return null;
  return (
    <div className="pi-backdrop" style={{ justifyContent: "center", alignItems: "center" }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxHeight: "82vh", display: "flex", flexDirection: "column", overflow: "hidden" }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head" style={{ borderBottom: "1px solid var(--line-soft)", flexShrink: 0 }}>
          <div className="col">
            <div className="pi-title">Export Project</div>
            <div className="pi-sub">Bundle screens, links, APIs and theme into a runnable app</div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-4" style={{ overflow: "auto", flex: 1 }}>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Framework</div>
            <div className="seg" style={{ flexWrap: "wrap" }}>
              {[
                { id: "react-vite", label: "React + Vite" },
                { id: "next", label: "Next.js" },
                { id: "astro", label: "Astro" },
                { id: "tanstack", label: "TanStack Start" },
              ].map((f) => (
                <button key={f.id} data-on={format === f.id} onClick={() => setFormat(f.id)}>{f.label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Routing</div>
            <div className="seg">
              {[
                { id: "react-router", label: "React Router" },
                { id: "file-based", label: "File-based" },
                { id: "hash", label: "Hash" },
              ].map((r) => <button key={r.id} data-on={routing === r.id} onClick={() => setRouting(r.id)}>{r.label}</button>)}
            </div>
          </div>
          <div>
            <div className="caps" style={{ marginBottom: 6 }}>Include</div>
            <div className="col gap-2">
              {[
                { key: "apis", label: "API clients & hooks", desc: "Fetch wrappers from saved APIs" },
                { key: "theme", label: "Theme tokens", desc: "OKLCH CSS variables + Tailwind config" },
                { key: "components", label: "Shared components", desc: "Reusable components from library" },
                { key: "tests", label: "Smoke tests", desc: "Basic Playwright or Vitest scaffolding" },
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
            <pre className="code-pane mono" style={{ fontSize: 11, padding: 10, borderRadius: 8, background: "var(--n-1)" }}>{`src/
  screens/
    Dashboard.tsx
    Orders.tsx
    OrderDetail.tsx
  components/
    LoginCard.tsx
    Sidebar.tsx
  api/
    useCustomers.ts
    useOrders.ts
  theme/
    tokens.css
  App.tsx
  main.tsx`}</pre>
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
