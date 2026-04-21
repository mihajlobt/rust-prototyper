import { useState } from "react";
import { Icons } from "@/icons";

export function PromptConfigModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState("component");
  const prompts = {
    component: `You are Prototyper's component generator. Output a single React/TSX function component using Tailwind v4. Library: shadcn/ui, lucide, motion, radix.`,
    screen: `You are Prototyper's screen generator. Output a single React/TSX screen as a default export. Use Tailwind v4 class names. Do not import icons — use inline SVG.`,
    theme: `You are a design system expert. Generate a CSS theme using OKLCH color tokens. Output Tailwind v4 compatible CSS variables with a cohesive palette.`,
  };
  const [texts, setTexts] = useState(prompts);
  if (!open) return null;
  return (
    <div className="pi-backdrop" onClick={onClose}>
      <div className="pi-drawer" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="pi-head">
          <div className="col">
            <div className="pi-title">Prompt Templates</div>
            <div className="pi-sub">Edit the system prompts sent to the model for each generator</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="seg">
            {["component", "screen", "theme"].map((t) => <button key={t} data-on={tab === t} onClick={() => setTab(t)}>{t}</button>)}
          </div>
          <button className="icon-btn" onClick={onClose}><Icons.x size={13} /></button>
        </div>
        <div className="pad-4 col gap-3" style={{ flex: 1, overflow: "auto" }}>
          <div className="caps">System prompt — {tab}</div>
          <textarea
            className="textarea mono"
            rows={10}
            value={texts[tab as keyof typeof texts]}
            onChange={(e) => setTexts({ ...texts, [tab]: e.target.value })}
          />
          <div className="row gap-2" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setTexts(prompts)}><Icons.zap size={11} /> Reset defaults</button>
            <button className="btn btn--acc" onClick={onClose}><Icons.check size={12} /> Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
