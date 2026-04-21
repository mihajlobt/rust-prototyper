import { useState } from "react";
import { Icons } from "@/icons";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { LoginCardMock } from "@/panels/ComponentsPanel";

function FileTree() {
  const tree: [string, number, boolean, string][] = [
    ["▾ 📁 src", 0, true, "f"],
    ["  ▾ 📁 components", 0, true, "f"],
    ["    📄 LoginCard.tsx", 1, false, "c"],
    ["    📄 Button.tsx", 0, false, "c"],
    ["  📄 App.tsx", 1, false, "c"],
    ["  📄 main.tsx", 0, false, "c"],
    ["  📄 index.css", 0, false, "s"],
    ["▾ 📁 public", 0, true, "f"],
    ["  📄 favicon.svg", 0, false, "i"],
    ["📄 package.json", 0, false, "j"],
    ["📄 vite.config.ts", 0, false, "c"],
    ["📄 tsconfig.json", 0, false, "j"],
  ];
  return (
    <>{tree.map(([t, on, _isf, _k], i) => (
      <div key={i} style={{ padding: "2px 4px", color: on ? "var(--fg)" : "var(--fg-dim)", background: on ? "var(--acc-soft)" : "transparent", borderRadius: 3, cursor: "pointer" }}>{t}</div>
    ))}</>
  );
}

export function RunnerPanel({ cmTheme }: { cmTheme: string }) {
  const [termTab, setTermTab] = useState("terminal");
  const [showTerm, setShowTerm] = useState(true);
  return (
    <div className="view-body">
      <div className="view-head">
        <div>
          <div className="view-title">Run <span className="pill mono" style={{ marginLeft: 8 }}><span className="sdot sdot--run" /> bun dev · :5173</span></div>
          <div className="view-sub">Sandboxed bun process. File ops, bash commands, and live preview.</div>
        </div>
        <div className="row gap-2">
          <button className="btn"><Icons.stop size={11} /> Stop</button>
          <button className="btn"><Icons.terminal size={12} /> New shell</button>
          <button className="btn btn--acc"><Icons.play size={11} /> bun dev</button>
        </div>
      </div>
      <div className="split3">
        <div className="split-pane" style={{ maxWidth: 230 }}>
          <div className="panel-head"><div className="panel-title">Files</div><span className="pill mono" style={{ marginLeft: "auto" }}>./generated</span></div>
          <div style={{ overflow: "auto", padding: 8, flex: 1, fontFamily: "var(--font-mono)", fontSize: 11 }}>
            <FileTree />
          </div>
        </div>
        <div className="sash sash--v" />
        <div className="split-pane" style={{ position: "relative" }}>
          <div className="panel-head">
            <div className="panel-title mono">src/App.tsx</div>
            <div style={{ flex: 1 }} />
          </div>
          <CodeMirrorEditor mode="jsx" theme={cmTheme} value={`import { useState } from 'react'
import { LoginCard } from './components/LoginCard'

export default function App() {
  const [user, setUser] = useState<string | null>(null)
  if (!user) return <LoginCard onSignIn={setUser} />
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Hi, {user}</h1>
    </main>
  )
}`} style={{ flex: 1 }} />

          {showTerm && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: "40%", display: "flex", flexDirection: "column", background: "var(--n-0)", borderTop: "1px solid var(--line)", zIndex: 3 }}>
              <div className="panel-head" style={{ flexShrink: 0, borderBottom: "1px solid var(--line-soft)" }}>
                <div className="seg" style={{ background: "transparent", border: "none", boxShadow: "none" }}>
                  <button data-on={termTab === "terminal"} onClick={() => setTermTab("terminal")}>Terminal</button>
                  <button data-on={termTab === "logs"} onClick={() => setTermTab("logs")}>Logs</button>
                  <button data-on={termTab === "net"} onClick={() => setTermTab("net")}>Network</button>
                </div>
                <div style={{ flex: 1 }} />
                <button className="icon-btn" onClick={() => setShowTerm(false)}><Icons.x size={12} /></button>
              </div>
              <div className="terminal" style={{ flex: 1, overflow: "auto" }}>
                {termTab === "terminal" && (
                  <>
                    <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="tl-cmd">bun install</span></div>
                    <div className="terminal-line tl-out"> + react@19.0.0</div>
                    <div className="terminal-line tl-out"> + react-dom@19.0.0</div>
                    <div className="terminal-line tl-out"> + tailwindcss@4.0.0-alpha.30</div>
                    <div className="terminal-line tl-out tl-ok"> installed 142 packages in 412ms</div>
                    <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="tl-cmd">bun dev</span></div>
                    <div className="terminal-line tl-out"> $ vite</div>
                    <div className="terminal-line tl-out tl-ok"> → Local:   http://localhost:5173/</div>
                    <div className="terminal-line tl-out">   ready in 218ms</div>
                    <div className="terminal-line"><span className="tl-host">proto</span><span className="tl-sep">:</span><span className="tl-cwd">generated</span><span className="tl-sig">$</span> <span className="cursor-blink">▋</span></div>
                  </>
                )}
                {termTab === "logs" && (
                  <>
                    <div className="terminal-line tl-out">[vite] hot reload: src/App.tsx</div>
                    <div className="terminal-line tl-out">[vite] page reload: /</div>
                    <div className="terminal-line tl-out tl-ok">[bun] GET / 200 in 12ms</div>
                    <div className="terminal-line tl-out">[bun] GET /assets/main.css 200 in 4ms</div>
                  </>
                )}
                {termTab === "net" && (
                  <>
                    <div className="terminal-line tl-out">GET  /v1/customers      200  42ms</div>
                    <div className="terminal-line tl-out">POST /v1/charges        201  88ms</div>
                    <div className="terminal-line tl-out">GET  /v1/subscriptions  200  31ms</div>
                    <div className="terminal-line tl-out tl-ok">WebSocket /ws          101  6ms</div>
                  </>
                )}
              </div>
            </div>
          )}

          {!showTerm && (
            <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 32, display: "flex", alignItems: "center", padding: "0 12px", gap: 8, background: "var(--n-1)", borderTop: "1px solid var(--line-soft)", cursor: "pointer", zIndex: 2 }} onClick={() => setShowTerm(true)}>
              <Icons.terminal size={11} />
              <span style={{ fontSize: 11, fontWeight: 500 }}>Terminal</span>
              <div style={{ flex: 1 }} />
              <span className="pill mono" style={{ fontSize: 9 }}><span className="sdot sdot--run" /> :5173</span>
            </div>
          )}
        </div>
        <div className="sash sash--v" />
        <div className="split-pane" style={{ maxWidth: 420 }}>
          <div className="panel-head">
            <div className="panel-title">Preview</div>
            <span className="pill mono" style={{ marginLeft: 8 }}>localhost:5173</span>
            <div style={{ flex: 1 }} />
            <button className="icon-btn"><Icons.fit size={12} /></button>
          </div>
          <div style={{ flex: 1, padding: 20, background: "var(--n-0)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <LoginCardMock />
          </div>
        </div>
      </div>
    </div>
  );
}
