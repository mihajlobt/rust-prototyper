// Workflow canvas — draggable nodes, curved edges, selection, animations.
import { useState, useRef, useEffect, useMemo } from "react";
import { Icons } from "@/icons";
import { NODE_CATS, NODE_LOOKUP, STARTER_NODES, STARTER_EDGES, SAVED_WORKFLOWS, LIB_THEMES, cx } from "@/data";

// ─────────────────────────────────────────────────────────────
// Node component
function WorkflowNode({ node, selected, running, done, onMouseDown, onClick }: any) {
  const def = NODE_LOOKUP[node.type];
  if (!def) return null;
  const Ic = Icons[def.icon as keyof typeof Icons] || Icons.cube;
  return (
    <div
      className={cx("node focus-ring", running && "node--running", done && "node--done")}
      data-selected={selected}
      style={{ position: "absolute", left: node.x, top: node.y, width: 168, minHeight: 64 }}
      onMouseDown={onMouseDown}
      onClick={onClick}
    >
      <div className="node-body">
        <div className="node-head">
          <div className="node-ico" style={{ color: `var(--${def.color})` }}>
            <Ic size={13} />
          </div>
          <div className="node-title">{node.label}</div>
          {running && <span className="sdot sdot--run" style={{ marginLeft: "auto" }} />}
          {done && !running && <span className="sdot sdot--ok" style={{ marginLeft: "auto" }} />}
        </div>
        <div className="node-sub">{node.subtitle || def.desc}</div>
        {running && <div className="node-stream mono">{node._stream || "generating…"}</div>}
      </div>
      <div className="node-port node-port--in" />
      <div className="node-port node-port--out" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Curved edge between two nodes
function edgePath(a: any, b: any) {
  const x1 = a.x + 168, y1 = a.y + 32;
  const x2 = b.x, y2 = b.y + 32;
  const dx = Math.max(40, (x2 - x1) * 0.45);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function WorkflowEdge({ a, b, active, done, style }: any) {
  const d = edgePath(a, b);
  const dashed = style === "dashed";
  const stroke = active ? "var(--acc)" : done ? "var(--acc-ok)" : "var(--n-5)";
  return (
    <g>
      <path d={d} stroke={stroke} strokeWidth={1.4} fill="none"
        strokeDasharray={dashed ? "5 4" : undefined}
        style={{ filter: active ? "drop-shadow(0 0 6px rgba(78,226,201,.6))" : undefined }} />
      {active && (
        <circle r="3" fill="var(--acc)">
          <animateMotion dur="1.2s" repeatCount="indefinite" path={d} />
        </circle>
      )}
    </g>
  );
}

// ─────────────────────────────────────────────────────────────
// Canvas (main)
export function WorkflowCanvas({ nodes, setNodes, edges, selectedId, setSelectedId, running, runState, edgeStyle }: any) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<any>(null);
  const [pan, setPan] = useState({ x: 0, y: 0, k: 0.85 });
  const [panning, setPanning] = useState<any>(null);

  const onNodeDown = (e: React.MouseEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const n = nodes.find((n: any) => n.id === id);
    const r = stageRef.current!.getBoundingClientRect();
    const px = (e.clientX - r.left - pan.x) / pan.k;
    const py = (e.clientY - r.top - pan.y) / pan.k;
    setDrag({ id, dx: px - n.x, dy: py - n.y });
    setSelectedId(id);
  };

  const onStageDown = (e: React.MouseEvent) => {
    if (e.button === 1 || (e.button === 0 && e.target === stageRef.current) || (e.target as HTMLElement).classList?.contains("stage-bg")) {
      setSelectedId(null);
      setPanning({ x: e.clientX, y: e.clientY, px: pan.x, py: pan.y });
    }
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (drag) {
        const r = stageRef.current!.getBoundingClientRect();
        const px = (e.clientX - r.left - pan.x) / pan.k;
        const py = (e.clientY - r.top - pan.y) / pan.k;
        setNodes((ns: any[]) => ns.map((n) => n.id === drag.id ? { ...n, x: px - drag.dx, y: py - drag.dy } : n));
      }
      if (panning) {
        setPan((p) => ({ ...p, x: panning.px + (e.clientX - panning.x), y: panning.py + (e.clientY - panning.y) }));
      }
    };
    const onUp = () => { setDrag(null); setPanning(null); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [drag, panning, pan, setNodes]);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01);
      const r = stageRef.current!.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      setPan((p) => {
        const k = Math.min(2.5, Math.max(0.3, p.k * factor));
        const ratio = k / p.k;
        return { k, x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio };
      });
    } else {
      setPan((p) => ({ ...p, x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };
  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const byId = useMemo(() => Object.fromEntries(nodes.map((n: any) => [n.id, n])), [nodes]);

  return (
    <div ref={stageRef} className="stage dotgrid" onMouseDown={onStageDown}>
      <div className="stage-bg" style={{ position: "absolute", inset: 0 }} />
      <div style={{ position: "absolute", top: 0, left: 0, transform: `translate(${pan.x}px, ${pan.y}px) scale(${pan.k})`, transformOrigin: "0 0" }}>
        <svg className="edges-svg" width="3000" height="1200" style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}>
          {edges.map((e: any, i: number) => {
            const a = byId[e.from], b = byId[e.to];
            if (!a || !b) return null;
            const active = running && runState?.active?.includes(e.to);
            const done = runState?.done?.includes(e.to);
            return <WorkflowEdge key={i} a={a} b={b} active={active} done={done} style={edgeStyle} />;
          })}
        </svg>
        {nodes.map((n: any) => {
          const active = running && runState?.active?.includes(n.id);
          const done = runState?.done?.includes(n.id);
          return (
            <WorkflowNode
              key={n.id} node={n}
              selected={selectedId === n.id}
              running={active} done={done}
              onMouseDown={(e: React.MouseEvent) => onNodeDown(e, n.id)}
              onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelectedId(n.id); }}
            />
          );
        })}
      </div>
      <div className="stage-tools">
        <button className="icon-btn" onClick={() => setPan((p) => ({ ...p, k: Math.min(2.5, p.k * 1.15) }))}><Icons.zoomIn /></button>
        <button className="icon-btn" onClick={() => setPan((p) => ({ ...p, k: Math.max(0.3, p.k * 0.85) }))}><Icons.zoomOut /></button>
        <button className="icon-btn" onClick={() => setPan({ x: 60, y: 40, k: 0.85 })}><Icons.fit /></button>
        <div className="mono" style={{ fontSize: 10, color: "var(--fg-mute)", padding: "0 6px" }}>{Math.round(pan.k * 100)}%</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Node Palette (left)
export function NodePalette({ onDragStart, query, setQuery }: any) {
  return (
    <div className="panel" style={{ width: 220 }}>
      <div className="panel-head">
        <div className="panel-title">Node Palette</div>
      </div>
      <div style={{ padding: "8px 10px 0" }}>
        <div style={{ fontSize: 11, color: "var(--fg-mute)", marginBottom: 8 }}>Drag nodes to the canvas</div>
        <div style={{ position: "relative" }}>
          <Icons.search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--fg-mute)" }} />
          <input className="input" placeholder="Search nodes…" style={{ paddingLeft: 26 }} value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>
      <div style={{ overflow: "auto", padding: "10px 10px 20px", flex: 1 }}>
        {NODE_CATS.map((cat) => {
          const items = cat.items.filter((it) => !query || it.label.toLowerCase().includes(query.toLowerCase()));
          if (!items.length) return null;
          return (
            <div key={cat.id} style={{ marginBottom: 12 }}>
              <div className="caps" style={{ padding: "4px 2px" }}>{cat.label}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {items.map((it) => {
                  const Ic = Icons[it.icon as keyof typeof Icons];
                  return (
                    <div key={it.type} className="pal-item" draggable onDragStart={(e) => onDragStart(e, it.type)}>
                      <div className="pal-ico" style={{ color: `var(--${cat.color})`, background: `color-mix(in oklch, var(--${cat.color}) 12%, transparent)` }}>
                        <Ic size={13} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500 }}>{it.label}</div>
                        <div style={{ fontSize: 10, color: "var(--fg-mute)" }}>{it.desc}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Workflows Browser (middle-left)
export function WorkflowsBrowser({ activeTab, setActiveTab, onLoad }: any) {
  const [q, setQ] = useState("");
  return (
    <div className="panel" style={{ width: 250 }}>
      <div className="panel-head" style={{ gap: 4 }}>
        <div className="seg">
          <button data-on={activeTab === "canvas"} onClick={() => setActiveTab("canvas")}><Icons.flow size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />Canvas</button>
          <button data-on={activeTab === "templates"} onClick={() => setActiveTab("templates")}><Icons.cube size={11} style={{ marginRight: 4, verticalAlign: "-1px" }} />Templates</button>
        </div>
        <div style={{ flex: 1 }} />
        <button className="icon-btn" title="New workflow"><Icons.plus size={13} /></button>
      </div>
      <div style={{ padding: 10, flexShrink: 0 }}>
        <div className="row gap-2" style={{ marginBottom: 8 }}>
          <div className="panel-title">Saved workflows</div>
          <span className="pill" style={{ marginLeft: "auto" }}>{SAVED_WORKFLOWS.length}</span>
        </div>
        <div style={{ position: "relative" }}>
          <Icons.search size={12} style={{ position: "absolute", left: 8, top: 8, color: "var(--fg-mute)" }} />
          <input className="input" placeholder="Search workflows…" style={{ paddingLeft: 26 }} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div style={{ overflow: "auto", flex: 1, padding: "0 10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {SAVED_WORKFLOWS.filter((w) => !q || w.name.toLowerCase().includes(q.toLowerCase())).map((w) => (
          <div key={w.id} className="wf-card">
            <div style={{ fontSize: 12, fontWeight: 600 }}>{w.name}</div>
            <div style={{ fontSize: 10.5, color: "var(--fg-mute)", marginTop: 2, lineHeight: 1.4 }}>{w.desc}</div>
            <div className="row gap-2" style={{ marginTop: 6, fontSize: 10, color: "var(--fg-mute)" }}>
              <span>{w.updated}</span>
              <span>·</span>
              <span>{w.nodes} nodes</span>
              <span>·</span>
              <span>{w.edges} edges</span>
            </div>
            <div className="row gap-2" style={{ marginTop: 8 }}>
              <button className="btn btn--acc" style={{ flex: 1, justifyContent: "center" }} onClick={() => onLoad?.(w)}>
                <Icons.folder size={12} /> Load
              </button>
              <button className="icon-btn" title="Delete"><Icons.trash size={12} /></button>
            </div>
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 10, color: "var(--fg-mute)", padding: "6px 0" }}>{SAVED_WORKFLOWS.length} workflows saved</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Properties Panel (right)
export function PropertiesPanel({ node, onPatch }: any) {
  if (!node) {
    return (
      <div className="panel panel--right" style={{ width: 300 }}>
        <div className="panel-head"><div className="panel-title">Properties</div></div>
        <div style={{ padding: 18, color: "var(--fg-mute)", fontSize: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg)", marginBottom: 4 }}>No node selected</div>
          Select a node on the canvas to view and edit its properties.
        </div>
      </div>
    );
  }
  const def = NODE_LOOKUP[node.type];
  if (!def) return null;
  const Ic = Icons[def.icon as keyof typeof Icons] || Icons.cube;
  return (
    <div className="panel panel--right" style={{ width: 300 }}>
      <div className="panel-head">
        <div className="panel-title">Properties</div>
        <span className="pill pill--acc" style={{ marginLeft: 6 }}>{def.cat}</span>
      </div>
      <div style={{ overflow: "auto", padding: 12, flex: 1 }}>
        <div style={{ marginBottom: 10 }}>
          <div className="caps">Label</div>
          <input className="input" value={node.label} onChange={(e) => onPatch({ label: e.target.value })} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div className="caps">Description</div>
          <input className="input" value={node.subtitle || ""} onChange={(e) => onPatch({ subtitle: e.target.value })} />
        </div>

        {node.type === "designSystem" && <DesignSystemProps node={node} onPatch={onPatch} />}
        {node.type === "requirements" && <RequirementsProps node={node} onPatch={onPatch} />}
        {node.type === "structure" && <StructureProps node={node} />}
        {node.type === "style" && <StyleProps node={node} />}
        {node.type === "bash" && <BashProps node={node} />}
        {node.type === "fetch" && <FetchProps node={node} />}
        {(node.type === "input" || node.type === "output") && (
          <div style={{ fontSize: 11, color: "var(--fg-mute)", padding: "8px 0" }}>
            {def.desc}. Connect this node to the rest of the graph.
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <div className="caps">Constraints</div>
          <div className="row gap-2" style={{ marginTop: 4 }}>
            <label className="input" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--fg-mute)", fontSize: 10 }}>MAX W</span>
              <input defaultValue="1440" style={{ background: "transparent", border: 0, color: "var(--fg)", width: "100%" }} />
            </label>
            <label className="input" style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--fg-mute)", fontSize: 10 }}>MAX H</span>
              <input defaultValue="auto" style={{ background: "transparent", border: 0, color: "var(--fg)", width: "100%" }} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

function DesignSystemProps({ node, onPatch }: any) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <div className="props-section">
        <div className="props-section-head" onClick={() => setOpen(!open)}>
          <Icons.palette size={12} />
          <span>Theme Selection</span>
          <Icons.chevD size={12} style={{ marginLeft: "auto", transform: open ? "" : "rotate(-90deg)" }} />
        </div>
        {open && (
          <div className="col gap-2" style={{ marginTop: 6 }}>
            {LIB_THEMES.slice(0, 3).map((t) => (
              <ThemeMiniCard key={t.id} t={t} selected={node.themeId === t.id} onSelect={() => onPatch({ themeId: t.id })} />
            ))}
          </div>
        )}
      </div>
      <div style={{ marginTop: 12 }}>
        <div className="caps">Visual style</div>
        <select className="input">
          <option>Minimal — Clean, simple, modern</option>
          <option>Editorial — Type-forward, spacious</option>
          <option>Playful — Rounded, vivid</option>
          <option>Technical — Dense, data-forward</option>
        </select>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="caps">Density</div>
        <select className="input">
          <option>Comfortable — Balanced spacing</option>
          <option>Compact</option>
          <option>Spacious</option>
        </select>
      </div>
    </>
  );
}

function ThemeMiniCard({ t, selected, onSelect }: any) {
  return (
    <div className="theme-mini" data-selected={selected} onClick={onSelect}>
      <div className="theme-mini-row">
        <button className="theme-btn" style={{ background: t.button, color: t.dark ? "#fff" : "#000" }}>Button</button>
        <button className="theme-btn" style={{ background: t.dark ? "#1f1b14" : "#e8e2d4", color: t.dark ? "#fff" : "#111", boxShadow: "inset 0 0 0 1px rgba(255,255,255,.08)" }}>Secondary</button>
      </div>
      <div className="theme-mini-demo">The quick brown fox</div>
      <div className="theme-mini-row" style={{ alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--fg)", flex: 1 }}>{t.name}</div>
        <div className="row gap-1">
          {t.swatches.map((s: string, i: number) => <div key={i} className="sw" style={{ background: s }} />)}
        </div>
        <div style={{ fontSize: 9, color: "var(--fg-mute)", marginLeft: 6, fontFamily: "var(--font-mono)" }}>SHADCN</div>
      </div>
    </div>
  );
}

function RequirementsProps({ node }: any) {
  return (
    <div>
      <div className="caps">Prompt</div>
      <textarea className="textarea" defaultValue={"A modern login card with email + password, remember-me, forgot-password link, and a primary submit."} rows={4} />
      <div className="caps" style={{ marginTop: 10 }}>Extract</div>
      <div className="row gap-1" style={{ flexWrap: "wrap", marginTop: 4 }}>
        {["intent", "constraints", "entities", "copy"].map((t) => <span key={t} className="tag">{t}</span>)}
      </div>
    </div>
  );
}
function StructureProps(_: any) {
  return (
    <div>
      <div className="caps">Framework</div>
      <select className="input"><option>React 19 + TS</option><option>Next.js</option><option>Remix</option></select>
      <div className="caps" style={{ marginTop: 10 }}>Output</div>
      <select className="input"><option>JSX component</option><option>Full page</option></select>
    </div>
  );
}
function StyleProps(_: any) {
  return (
    <div>
      <div className="caps">CSS</div>
      <select className="input"><option>Tailwind v4</option><option>CSS Modules</option><option>Vanilla CSS</option></select>
      <div className="caps" style={{ marginTop: 10 }}>Library</div>
      <select className="input"><option>shadcn/ui</option><option>Radix only</option><option>None</option></select>
    </div>
  );
}
function BashProps(_: any) {
  return (
    <div>
      <div className="caps">Command</div>
      <textarea className="textarea mono" defaultValue={"bun install && bun run build"} style={{ fontSize: 11 }} />
      <div className="caps" style={{ marginTop: 10 }}>Cwd</div>
      <input className="input mono" defaultValue="./generated" style={{ fontSize: 11 }} />
    </div>
  );
}
function FetchProps(_: any) {
  return (
    <div>
      <div className="caps">Endpoint</div>
      <input className="input mono" defaultValue="GET /api/users/{id}" style={{ fontSize: 11 }} />
      <div className="caps" style={{ marginTop: 10 }}>Headers</div>
      <textarea className="textarea mono" defaultValue={"Authorization: Bearer {{token}}\nAccept: application/json"} rows={3} style={{ fontSize: 11 }} />
    </div>
  );
}
