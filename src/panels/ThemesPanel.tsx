import { useState } from "react";
import { Icons } from "@/icons";
import { LIB_THEMES } from "@/data";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

export function ThemesPanel({ cmTheme }: { cmTheme: string }) {
  const [selected, setSelected] = useState("t4");
  const [prompt, setPrompt] = useState("A cool teal-on-ink cyberpunk theme using OKLCH, designed for a developer dashboard.");
  const [showCss, setShowCss] = useState(false);
  const [showLibrary, setShowLibrary] = useState(true);
  const theme = LIB_THEMES.find((t) => t.id === selected) ?? LIB_THEMES[0]!;
  const isDark = theme.dark;

  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane">
          <div className="panel-head"><div className="panel-title">Prompt</div></div>
          <div className="pad-4 col gap-3" style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            <textarea className="textarea" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={4} />
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <button className="btn btn--acc"><Icons.sparkles size={12} /> Generate</button>
              <button className="btn"><Icons.save size={12} /> Save as preset</button>
              <div style={{ flex: 1 }} />
              <div className="seg">
                <button data-on="true">shadcn</button>
                <button>daisy</button>
                <button>bootstrap</button>
                <button>generic</button>
              </div>
            </div>
            <div className="hair" style={{ margin: "2px 0" }} />
            <button className="row gap-2" style={{ alignItems: "center", padding: "4px 0", background: "none", border: "none", color: "var(--fg-mute)", cursor: "pointer", fontSize: 11 }} onClick={() => setShowLibrary(!showLibrary)}>
              <Icons.chevD size={10} style={{ transform: showLibrary ? "rotate(0deg)" : "rotate(-90deg)", transition: "transform .15s" }} />
              <span className="caps">Library</span>
              <span className="pill" style={{ fontSize: 9 }}>{LIB_THEMES.length}</span>
            </button>
            {showLibrary && (
              <div className="grid-3">
                {LIB_THEMES.map((t) => (
                  <div key={t.id} className="card theme-card" data-selected={selected === t.id} onClick={() => setSelected(t.id)}>
                    <div className="theme-preview">
                      <div className="theme-preview-hero" style={{ background: t.dark ? "#0f0e0c" : "#faf8f2", color: t.dark ? "#fff" : "#111" }}>
                        <div style={{ display: "flex", gap: 4, marginBottom: 6 }}>
                          <button className="theme-btn" style={{ background: t.button, color: t.dark ? "#fff" : "#000", fontSize: 9 }}>Primary</button>
                          <button className="theme-btn" style={{ background: "transparent", color: t.dark ? "#fff" : "#111", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)", fontSize: 9 }}>Ghost</button>
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 600 }}>The quick brown fox</div>
                        <div style={{ fontSize: 9, opacity: 0.7 }}>jumps over the lazy dog</div>
                      </div>
                    </div>
                    <div className="row gap-2" style={{ padding: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 500 }}>{t.name}</span>
                      <div className="row gap-1" style={{ marginLeft: "auto" }}>
                        {t.swatches.map((s, i) => <div key={i} className="sw" style={{ background: s }} />)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="sash sash--v" />
        <div className="split-pane" style={{ position: "relative" }}>
          <div style={{ flex: 1, overflow: "auto", padding: 24, background: isDark ? "#0c0c11" : "#fafafa", color: isDark ? "#fff" : "#111" }}>
            <div style={{ maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Common Components</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "none", cursor: "default", background: theme.button, color: isDark ? "#fff" : "#000" }}>Primary</button>
                <button style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "none", cursor: "default", background: "transparent", color: isDark ? "#fff" : "#111", boxShadow: `inset 0 0 0 1px ${theme.accent}40` }}>Secondary</button>
                <button style={{ padding: "6px 12px", borderRadius: 8, fontSize: 12, border: "none", cursor: "default", background: "transparent", color: theme.accent, opacity: 0.9 }}>Ghost</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }}>Email</label>
                <input defaultValue="hello@prototyper.dev" style={{ padding: "8px 10px", borderRadius: 8, fontSize: 12, background: isDark ? "rgba(255,255,255,0.06)" : "#fff", border: `1px solid ${theme.accent}30`, color: "inherit", outline: "none" }} />
              </div>
              <div style={{ padding: 16, borderRadius: 10, background: isDark ? "rgba(255,255,255,0.05)" : "#fff", border: `1px solid ${theme.accent}20`, boxShadow: isDark ? "0 10px 30px rgba(0,0,0,.3)" : "0 4px 12px rgba(0,0,0,.05)" }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>Invite team members</div>
                <div style={{ fontSize: 11, opacity: 0.7, marginTop: 4 }}>Send an invite link to collaborate.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                  <span className="pill mono" style={{ fontSize: 10 }}>https://proto.dev/invite</span>
                  <button style={{ padding: "4px 8px", borderRadius: 6, fontSize: 10, border: "none", cursor: "default", background: theme.button, color: isDark ? "#fff" : "#000" }}>Copy</button>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 11, opacity: 0.7 }}>Status</label>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8, border: `1px solid ${theme.accent}30`, background: isDark ? "rgba(255,255,255,0.06)" : "#fff", cursor: "default" }}>
                  <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.accent }} />
                  <span style={{ fontSize: 12, flex: 1 }}>Active</span>
                  <Icons.chevD size={10} style={{ opacity: 0.6 }} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {["Design", "Engineering", "Marketing"].map((tag, i) => (
                  <span key={tag} style={{ padding: "4px 10px", borderRadius: 6, fontSize: 11, background: i === 0 ? theme.accent + "20" : (isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"), color: i === 0 ? theme.accent : "inherit", border: i === 0 ? `1px solid ${theme.accent}40` : `1px solid transparent` }}>{tag}</span>
                ))}
              </div>
            </div>
          </div>

          {showCss && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "45%", display: "flex", flexDirection: "column", background: "var(--n-0)", borderTop: "1px solid var(--line)", zIndex: 3 }}>
              <div className="panel-head" style={{ flexShrink: 0, borderBottom: "1px solid var(--line-soft)" }}>
                <div className="panel-title">CSS Output</div>
                <div style={{ flex: 1 }} />
                <span className="pill mono" style={{ fontSize: 9 }}>oklch</span>
                <button className="icon-btn" onClick={() => setShowCss(false)}><Icons.x size={12} /></button>
              </div>
              <CodeMirrorEditor mode="css" theme={cmTheme} value={`:root {
  --background: oklch(0.18 0.025 200);
  --foreground: oklch(0.96 0.008 170);
  --card:       oklch(0.22 0.028 195);
  --border:     oklch(0.30 0.030 195);
  --primary:    oklch(0.82 0.14 180);
  --primary-foreground: oklch(0.18 0.04 200);
  --accent:     oklch(0.78 0.16 176);
  --muted:      oklch(0.28 0.018 200);
  --radius:     0.5rem;
}
.dark {
  --background: oklch(0.14 0.025 200);
}
@font-face { font-family: "Geist"; src: ... }`} style={{ flex: 1 }} />
            </div>
          )}

          {!showCss && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 32, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, background: "var(--n-1)", borderTop: "1px solid var(--line-soft)", cursor: "pointer", zIndex: 2 }} onClick={() => setShowCss(true)}>
              <Icons.terminal size={11} />
              <span style={{ fontSize: 11, fontWeight: 500 }}>CSS Output</span>
              <div style={{ flex: 1 }} />
              <span className="pill mono" style={{ fontSize: 9 }}>oklch</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
