import { useState, useEffect, useRef } from "react";
import { Icons } from "@/icons";

const presets = [
  { id: "auto", name: "Auto", icon: "cpu", prompt: "" },
  { id: "glass", name: "Glassmorphism", icon: "sparkles", prompt: "Use glassmorphism with translucent frosted-glass surfaces, subtle backdrop blur, and thin light borders." },
  { id: "minimal", name: "Minimal", icon: "grid", prompt: "Use a minimal, clean aesthetic with ample whitespace, thin typography, and restrained color usage." },
  { id: "neon", name: "Neon", icon: "zap", prompt: "Use a neon cyberpunk aesthetic with high-contrast dark backgrounds, vibrant glowing accents, and sharp edges." },
  { id: "paper", name: "Paper", icon: "file", prompt: "Use a tactile paper/skeuomorphic aesthetic with soft shadows, realistic textures, and warm muted tones." },
];

export function StylePresetPicker({ value, onChange }: { value?: string; onChange?: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button className="pill mono" onClick={() => setOpen((o) => !o)} style={{ cursor: "pointer", border: open ? "1px solid var(--acc)" : undefined }}>
        <Icons.layers size={11} style={{ color: "var(--fg-mute)", marginRight: 4 }} />
        {value || "Auto"} <Icons.chevD size={10} style={{ opacity: 0.6 }} />
      </button>
      {open && (
        <div className="mp-pop" style={{ minWidth: 180 }}>
          {presets.map((p) => {
            const Ic = Icons[p.icon as keyof typeof Icons];
            return (
              <button key={p.id} className="mp-row" data-on={value === p.name} onClick={() => { onChange?.(p.name); setOpen(false); }}>
                <Ic size={12} />
                <span style={{ fontSize: 11 }}>{p.name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
