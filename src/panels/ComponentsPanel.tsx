import { useState } from "react";
import { Icons } from "@/icons";
import { MODELS, AttachComposer, PromptInspector } from "@/prompt-inspector";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { ThemePickerDropdown } from "@/components/ThemePickerDropdown";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { AddLibraryModal } from "@/modals/AddLibraryModal";

export function LoginCardMock() {
  return (
    <div style={{ width: 340, padding: 26, borderRadius: 16, background: "rgba(20,24,34,.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 30px 80px rgba(0,0,0,.55)" }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>Welcome back</div>
      <div style={{ fontSize: 12, color: "var(--fg-mute)", marginBottom: 18 }}>Sign in to your workspace.</div>
      <div className="caps" style={{ fontSize: 9 }}>Email</div>
      <input className="input" defaultValue="you@prototyper.dev" style={{ marginBottom: 10 }} />
      <div className="row gap-2">
        <div className="caps" style={{ fontSize: 9, flex: 1 }}>Password</div>
        <a className="link-sub" style={{ fontSize: 10 }}>Forgot?</a>
      </div>
      <input className="input" type="password" defaultValue="••••••••••" style={{ marginBottom: 14 }} />
      <button className="btn btn--acc" style={{ width: "100%", justifyContent: "center", padding: "8px 10px" }}>Sign in</button>
      <div style={{ textAlign: "center", fontSize: 11, color: "var(--fg-mute)", marginTop: 12 }}>No account? <a className="link-sub">Request access</a></div>
    </div>
  );
}

export function ComponentsPanel({ modelId, cmTheme }: { modelId: string; cmTheme: string }) {
  const [prompt, setPrompt] = useState("A login card with email + password, glassmorphic surface, subtle glow on focus.");
  const [attachments, setAttachments] = useState<{ id: string; name: string; size: number; w?: number; h?: number; preview?: string }[]>([]);
  const [inspector, setInspector] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [showAddLib, setShowAddLib] = useState(false);
  const [libs, setLibs] = useState(["shadcn/ui", "lucide", "motion", "radix", "tailwind v4"]);
  const [activeTheme, setActiveTheme] = useState<(typeof import("@/data").LIB_THEMES)[number] | null>(null);
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]!;
  const system = `You are Prototyper's component generator. Output a single React/TSX function component using Tailwind v4. Library: shadcn/ui, lucide, motion, radix.`;

  return (
    <div className="view-body">
      <div className="split">
        <div className="split-pane" style={{ maxWidth: 380 }}>
          <div className="panel-head"><div className="panel-title">Prompt</div></div>
          <div className="pad-4 col gap-3" style={{ overflow: "auto", flex: 1 }}>
            <AttachComposer
              value={prompt}
              setValue={setPrompt}
              attachments={attachments}
              setAttachments={setAttachments}
              model={model}
              onOpenPrompt={() => setInspector(true)}
              onSend={() => {}}
              showUpdate={false}
              placeholder="Describe the component…"
            />
            <div className="row gap-2">
              <button className="btn" onClick={() => setShowSave(true)}><Icons.save size={12} /> Save</button>
              <button className="btn" onClick={() => setShowExport(true)}><Icons.file size={12} /> Export</button>
              <div style={{ flex: 1 }} />
            </div>
            <div className="hair" style={{ margin: "2px 0" }} />
            <div className="row gap-2" style={{ alignItems: "center" }}>
              <span className="caps">Libraries</span>
              <span className="pill mono" style={{ fontSize: 9 }}>{libs.length}</span>
            </div>
            <div className="row gap-1" style={{ flexWrap: "wrap" }}>
              {libs.map((l) => (
                <span key={l} className="tag" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  {l}
                  <button className="icon-btn" style={{ width: 12, height: 12 }} onClick={() => setLibs((ls) => ls.filter((x) => x !== l))}><Icons.x size={9} /></button>
                </span>
              ))}
              <button className="tag" style={{ cursor: "pointer" }} onClick={() => setShowAddLib(true)}>+ add</button>
            </div>
            <ThemePickerDropdown value={activeTheme} onChange={setActiveTheme} />
          </div>
        </div>
        <div className="sash sash--v" />
        <div className="split-pane" style={{ position: "relative" }}>
          <div style={{ flex: 1, padding: 28, display: "flex", alignItems: "center", justifyContent: "center", background: "repeating-linear-gradient(45deg, var(--n-0), var(--n-0) 12px, var(--n-1) 12px, var(--n-1) 24px)" }}>
            <LoginCardMock />
          </div>

          {showCode && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "45%", display: "flex", flexDirection: "column", background: "var(--n-0)", borderTop: "1px solid var(--line)", zIndex: 3 }}>
              <div className="panel-head" style={{ flexShrink: 0, borderBottom: "1px solid var(--line-soft)" }}>
                <div className="panel-title">Code</div>
                <div style={{ flex: 1 }} />
                <div className="pill mono"><span className="sdot sdot--ok" /> built · 180ms</div>
                <button className="icon-btn" onClick={() => setShowCode(false)}><Icons.x size={12} /></button>
              </div>
              <CodeMirrorEditor mode="jsx" theme={cmTheme} value={`export function LoginCard({ onSignIn }: { onSignIn: (user: string) => void }) {
  return (
    <div className="w-[340px] p-7 rounded-2xl bg-[rgba(20,24,34,.6)] backdrop-blur-xl border border-white/[0.08] shadow-2xl">
      <div className="text-lg font-semibold mb-1">Welcome back</div>
      <div className="text-xs text-muted mb-5">Sign in to your workspace.</div>
      <label className="text-[9px] uppercase tracking-wider">Email</label>
      <input className="input mb-3" defaultValue="you@prototyper.dev" />
      <div className="flex gap-2">
        <label className="text-[9px] uppercase tracking-wider flex-1">Password</label>
        <a className="link-sub text-[10px]">Forgot?</a>
      </div>
      <input className="input mb-4" type="password" defaultValue="••••••••••" />
      <button className="btn btn--acc w-full justify-center py-2">Sign in</button>
      <div className="text-center text-[11px] text-muted mt-3">
        No account? <a className="link-sub">Request access</a>
      </div>
    </div>
  );
}`} style={{ flex: 1 }} />
            </div>
          )}

          {!showCode && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 32, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, background: "var(--n-1)", borderTop: "1px solid var(--line-soft)", cursor: "pointer", zIndex: 2 }} onClick={() => setShowCode(true)}>
              <Icons.terminal size={11} />
              <span style={{ fontSize: 11, fontWeight: 500 }}>Code</span>
              <div style={{ flex: 1 }} />
              <div className="pill mono" style={{ fontSize: 9 }}><span className="sdot sdot--ok" /> built · 180ms</div>
            </div>
          )}
        </div>
      </div>
      <PromptInspector
        open={inspector}
        onClose={() => setInspector(false)}
        title="Components → Generate"
        model={model.id}
        system={system}
        messages={[]}
        user={prompt}
        attachments={attachments}
        cmTheme={cmTheme}
      />
      <ComponentExportModal open={showExport} onClose={() => setShowExport(false)} />
      <SaveComponentModal open={showSave} onClose={() => setShowSave(false)} />
      <AddLibraryModal open={showAddLib} onClose={() => setShowAddLib(false)} onAdd={(lib) => setLibs((ls) => [...ls, lib])} />
    </div>
  );
}
