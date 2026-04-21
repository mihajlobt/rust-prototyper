import { useState, useEffect, useRef } from "react";
import { Icons } from "@/icons";
import { LIB_THEMES } from "@/data";

export function ThemePickerDropdown({ value, onChange }: { value?: (typeof LIB_THEMES)[number] | null; onChange?: (v: (typeof LIB_THEMES)[number] | null) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={rootRef} className="col gap-2" style={{ position: "relative" }}>
      <div className="row gap-2" style={{ alignItems: "center" }}>
        <span className="caps">Theme</span>
        {value && (
          <button className="pill pill--acc" style={{ fontSize: 9, cursor: "pointer" }} onClick={() => onChange?.(null)}>
            <Icons.x size={9} /> {value.name}
          </button>
        )}
      </div>
      <button
        className="card"
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "6px 10px", display: "flex", alignItems: "center", gap: 8, cursor: "pointer", borderColor: open ? "var(--acc)" : undefined }}
      >
        {value ? (
          <>
            <div className="sw" style={{ background: value.swatches[0], width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 500 }}>{value.name}</span>
          </>
        ) : (
          <span style={{ fontSize: 11, color: "var(--fg-mute)" }}>Select a theme…</span>
        )}
        <div style={{ flex: 1 }} />
        <Icons.chevD size={10} style={{ opacity: 0.6, transform: open ? "rotate(180deg)" : "none", transition: "transform .15s" }} />
      </button>
      {open && (
        <div className="mp-pop" style={{ position: "absolute", top: "100%", left: 0, right: 0, zIndex: 300, marginTop: 4, maxHeight: 320, overflow: "auto" }}>
          {LIB_THEMES.map((t) => (
            <button
              key={t.id}
              className="mp-row"
              data-on={value?.id === t.id}
              onClick={() => { onChange?.(value?.id === t.id ? null : t); setOpen(false); }}
              style={{ flexDirection: "column", alignItems: "stretch", gap: 6, padding: 10 }}
            >
              <div className="row gap-2" style={{ alignItems: "center" }}>
                <div className="sw" style={{ background: t.swatches[0], width: 14, height: 14, borderRadius: 3, flexShrink: 0 }} />
                <span style={{ fontSize: 12, fontWeight: 500 }}>{t.name}</span>
                <span className="pill mono" style={{ marginLeft: "auto", fontSize: 9 }}>{t.cat}</span>
              </div>
              <div className="theme-preview" style={{ height: 50, borderRadius: 6, overflow: "hidden" }}>
                <div className="theme-preview-hero" style={{ background: t.dark ? "#0f0e0c" : "#faf8f2", color: t.dark ? "#fff" : "#111", padding: "6px 8px" }}>
                  <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                    <button className="theme-btn" style={{ background: t.button, color: t.dark ? "#fff" : "#000", fontSize: 8, padding: "2px 6px" }}>Primary</button>
                    <button className="theme-btn" style={{ background: "transparent", color: t.dark ? "#fff" : "#111", boxShadow: "inset 0 0 0 1px rgba(0,0,0,.15)", fontSize: 8, padding: "2px 6px" }}>Ghost</button>
                  </div>
                  <div style={{ fontSize: 9, opacity: 0.8 }}>The quick brown fox</div>
                </div>
              </div>
              <div className="row gap-1" style={{ justifyContent: "flex-end" }}>
                {t.swatches.map((s, i) => <div key={i} className="sw" style={{ background: s, width: 10, height: 10, borderRadius: 2 }} />)}
              </div>
            </button>
          ))}
        </div>
      )}
      {value && (
        <div style={{ fontSize: 10, color: "var(--fg-mute)", lineHeight: 1.4, padding: "4px 6px", borderRadius: 6, background: "var(--n-1)", border: "1px solid var(--line-soft)" }}>
          Injected: "Apply the <strong>{value.name}</strong> theme with accent {value.swatches[0]} and surface {value.swatches[2]}."
        </div>
      )}
    </div>
  );
}
