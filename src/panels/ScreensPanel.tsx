import { useState } from "react";
import { Icons } from "@/icons";
import { LIB_SCREENS, cx } from "@/data";
import { MODELS, AttachComposer, PromptInspector } from "@/prompt-inspector";
import { ExportModal } from "@/modals/ExportModal";

export function DashboardMock() {
  return (
    <div style={{ width: 880, height: 540, background: "#0f0f14", borderRadius: 12, overflow: "hidden", boxShadow: "0 30px 80px rgba(0,0,0,.5)", display: "grid", gridTemplateColumns: "160px 1fr" }}>
      <div style={{ background: "#0a0a0e", borderRight: "1px solid #1f1f2b", padding: 14 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 12 }}>Acme Inc.</div>
        {["Home", "Orders", "Customers", "Products", "Reports"].map((x, i) => (
          <div key={x} style={{ padding: "5px 8px", fontSize: 11, color: i === 1 ? "#fff" : "#8c92a6", background: i === 1 ? "#1a1b28" : "transparent", borderRadius: 5, marginBottom: 2 }}>{x}</div>
        ))}
      </div>
      <div style={{ padding: 16, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#fff" }}>Orders</div>
          <button style={{ padding: "5px 10px", fontSize: 11, background: "#4ee2c9", color: "#001814", border: 0, borderRadius: 6 }}>New order</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 14 }}>
          {[["Revenue", "$184,239", "+12%"], ["Orders", "1,284", "+5%"], ["Refunds", "23", "-18%"]].map(([a, b, c]) => (
            <div key={a} style={{ background: "#141522", padding: 12, borderRadius: 8, border: "1px solid #1f1f2b" }}>
              <div style={{ fontSize: 10, color: "#8c92a6" }}>{a}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#fff" }}>{b}</div>
              <div style={{ fontSize: 10, color: (c as string).startsWith("+") ? "#5cd684" : "#ff6183" }}>{c}</div>
            </div>
          ))}
        </div>
        <div style={{ background: "#141522", border: "1px solid #1f1f2b", borderRadius: 8, overflow: "hidden" }}>
          {["#01245", "#01244", "#01243", "#01242", "#01241"].map((id, i) => (
            <div key={id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 80px 80px", padding: "8px 12px", fontSize: 11, color: "#cdd3e3", borderBottom: i < 4 ? "1px solid #1f1f2b" : "none" }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "#8c92a6" }}>{id}</span>
              <span>Customer {i + 1}</span>
              <span>$240</span>
              <span style={{ color: i % 2 ? "#5cd684" : "#f5b151" }}>{i % 2 ? "Paid" : "Pending"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScreensPanel({ modelId, cmTheme }: { modelId: string; cmTheme: string }) {
  const [active, setActive] = useState("sc1");
  const [device, setDevice] = useState("desktop");
  const [composer, setComposer] = useState("Make the KPIs bigger, hide the sidebar on mobile. Match the visual style of the attached dribbble shot.");
  const [attachments, setAttachments] = useState([
    { id: "seed1", name: "dribbble-shot-2847.png", size: 284000, w: 1600, h: 1200, preview: "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="%234ee2c9"/><stop offset="1" stop-color="%23a78bfa"/></linearGradient></defs><rect width="160" height="120" fill="url(%23g)"/><rect x="16" y="24" width="38" height="72" fill="rgba(255,255,255,.2)" rx="4"/><rect x="64" y="24" width="80" height="30" fill="rgba(255,255,255,.3)" rx="4"/><rect x="64" y="62" width="80" height="34" fill="rgba(255,255,255,.2)" rx="4"/></svg>`) },
  ]);
  const [inspector, setInspector] = useState(false);
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]!;

  const messages = [
    { role: "user", content: "A dashboard with a sidebar, top stats, and a recent orders table." },
    { role: "assistant", content: "Planned: sidebar (nav), 3 KPI cards, table w/ pagination. Generated dashboard v1 with 12 elements." },
    { role: "user", content: "Make the KPIs bigger, hide the sidebar on mobile." },
  ];
  const system = `You are Prototyper's screen generator.\nOutput a single React/TSX screen as a default export.\nUse Tailwind v4 class names. Do not import icons — use inline SVG.\nCurrent theme: Glassmorphism (teal accent, dark surfaces).\nCurrent design system: shadcn/ui\nCurrent device target: ${device}\nReply with XML tags: <plan/>, <code/>, <notes/>.`;
  const tools = [
    { name: "save_screen", body: "Persist the generated screen to the library." },
    { name: "link_screens", body: "Create a navigation link between two screens." },
  ];

  const [linkMode, setLinkMode] = useState(false);
  const [links, setLinks] = useState([
    { id: "l1", from: "sidebar-orders", to: "sc2", label: "Orders nav", type: "navigate" },
    { id: "l2", from: "btn-new-order", to: "sc3", label: "New order", type: "modal" },
  ]);
  const [selectedLinkEl, setSelectedLinkEl] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

  const linkableElements = [
    { id: "sidebar-home", label: "Sidebar · Home", x: 8, y: 10 },
    { id: "sidebar-orders", label: "Sidebar · Orders", x: 8, y: 15 },
    { id: "sidebar-customers", label: "Sidebar · Customers", x: 8, y: 20 },
    { id: "btn-new-order", label: "Button · New order", x: 82, y: 12 },
    { id: "row-order", label: "Table row · Order", x: 50, y: 55 },
  ];

  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 380 }}>
          {linkMode ? (
            <>
              <div className="panel-head"><div className="panel-title">Links</div><span className="pill" style={{ marginLeft: "auto" }}>{links.length}</span></div>
              <div style={{ overflow: "auto", padding: 12, flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                {links.map((l) => (
                  <div key={l.id} className="card" style={{ padding: 10 }}>
                    <div className="row gap-2" style={{ alignItems: "center" }}>
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{l.label}</span>
                      <span className="pill mono" style={{ marginLeft: "auto", fontSize: 9 }}>{l.type}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--fg-mute)", marginTop: 4 }}>
                      {linkableElements.find((e) => e.id === l.from)?.label || l.from} → {LIB_SCREENS.find((s) => s.id === l.to)?.name || l.to}
                    </div>
                  </div>
                ))}
                <div className="hair" style={{ margin: "4px 0" }} />
                <div className="caps">Click an element in preview to start a link</div>
              </div>
            </>
          ) : (
            <>
              <div className="panel-head"><div className="panel-title">Chat</div><span className="pill mono" style={{ marginLeft: "auto" }}>3 turns</span></div>
              <div style={{ overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10, flex: 1 }}>
                <div className="chat-msg chat-msg--u"><div className="chat-msg-body">A dashboard with a sidebar, top stats, and a recent orders table.</div></div>
                <div className="chat-msg chat-msg--a"><div className="chat-msg-body"><span className="pill pill--acc" style={{ fontSize: 10, marginBottom: 6 }}>✧ thinking</span><div style={{ marginTop: 4 }}>Planned: sidebar (nav), 3 KPI cards, table w/ pagination. Generating…</div></div></div>
                <div className="chat-msg chat-msg--u"><div className="chat-msg-body">Make the KPIs bigger, hide the sidebar on mobile.</div></div>
              </div>
              <div style={{ padding: 10, borderTop: "1px solid var(--line-soft)" }}>
                <AttachComposer
                  value={composer}
                  setValue={setComposer}
                  attachments={attachments}
                  setAttachments={setAttachments}
                  model={model}
                  onOpenPrompt={() => setInspector(true)}
                  onSend={() => { /* demo */ }}
                  placeholder="Describe the screen or refine…"
                />
              </div>
            </>
          )}
        </div>
        <div className="sash sash--v" />
        <div className="split-pane">
          <div className="panel-head">
            <div className="panel-title">{linkMode ? "Select element to link" : "Preview"}</div>
            <div className="seg" style={{ marginLeft: 10 }}>
              {["desktop", "tablet", "mobile"].map((d) => <button key={d} data-on={device === d} onClick={() => setDevice(d)}>{d}</button>)}
            </div>
            <div style={{ flex: 1 }} />
            <button className={cx("btn", linkMode && "btn--acc")} style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setLinkMode(!linkMode)}>
              <Icons.link size={11} /> {linkMode ? "Done" : "Link"}
            </button>
            <button className="btn" style={{ padding: "4px 8px", fontSize: 11 }} onClick={() => setShowExport(true)}><Icons.file size={11} /> Export</button>
            <div className="hair" style={{ margin: "0 6px", height: 18 }} />
            <button className="icon-btn"><Icons.zoomOut size={12} /></button>
            <span className="mono" style={{ fontSize: 11, color: "var(--fg-mute)" }}>100%</span>
            <button className="icon-btn"><Icons.zoomIn size={12} /></button>
          </div>
          <div style={{ flex: 1, padding: 28, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", background: "var(--n-0)", position: "relative" }}>
            <div style={{ position: "relative" }}>
              <DashboardMock />
              {linkMode && linkableElements.map((el) => {
                const hasLink = links.some((l) => l.from === el.id);
                const isSelected = selectedLinkEl === el.id;
                return (
                  <div key={el.id} style={{ position: "absolute", left: `${el.x}%`, top: `${el.y}%`, zIndex: 10 }}>
                    <div
                      onClick={() => setSelectedLinkEl(isSelected ? null : el.id)}
                      style={{
                        width: 44, height: 26,
                        borderRadius: 4,
                        border: isSelected ? "2px solid var(--acc)" : hasLink ? "2px dashed var(--acc)" : "2px dashed var(--fg-mute)",
                        background: isSelected ? "rgba(78,226,201,.2)" : hasLink ? "rgba(78,226,201,.1)" : "rgba(255,255,255,.06)",
                        cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}
                      title={el.label}
                    >
                      {hasLink && <Icons.link size={10} style={{ color: "var(--acc)" }} />}
                    </div>
                    {isSelected && (
                      <div className="card" style={{ position: "absolute", top: 30, left: 0, width: 180, padding: 8, zIndex: 20, boxShadow: "var(--sh-pop)" }} onClick={(e) => e.stopPropagation()}>
                        <div className="caps" style={{ fontSize: 9, marginBottom: 4 }}>Link to screen</div>
                        <div className="col gap-1" style={{ marginBottom: 6 }}>
                          {LIB_SCREENS.filter((sc) => sc.id !== active).map((sc) => (
                            <button key={sc.id} className="rail-item" style={{ padding: "4px 6px", fontSize: 11 }} onClick={() => {
                              const existing = links.find((l) => l.from === el.id);
                              if (existing) {
                                setLinks((ls) => ls.map((l) => l.id === existing.id ? { ...l, to: sc.id, label: `${el.label} → ${sc.name}` } : l));
                              } else {
                                setLinks((ls) => [...ls, { id: "l" + Date.now(), from: el.id, to: sc.id, label: `${el.label} → ${sc.name}`, type: "navigate" }]);
                              }
                              setSelectedLinkEl(null);
                            }}>
                              {sc.name}
                            </button>
                          ))}
                        </div>
                        <div className="caps" style={{ fontSize: 9, marginBottom: 4 }}>Transition</div>
                        <div className="seg" style={{ flexWrap: "wrap" }}>
                          {["navigate", "modal", "drawer", "sheet"].map((t) => (
                            <button key={t} style={{ fontSize: 9, padding: "3px 6px" }} onClick={() => {
                              const existing = links.find((l) => l.from === el.id);
                              if (existing) setLinks((ls) => ls.map((l) => l.id === existing.id ? { ...l, type: t } : l));
                            }}>
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <PromptInspector
        open={inspector}
        onClose={() => setInspector(false)}
        title="Screens → Generate"
        model={model.id}
        system={system}
        messages={messages}
        user={composer}
        attachments={attachments}
        tools={tools}
        cmTheme={cmTheme}
      />
      <ExportModal open={showExport} onClose={() => setShowExport(false)} />
    </div>
  );
}
