import { useState, useEffect } from "react";
import { Icons } from "@/icons";
import { STARTER_NODES, STARTER_EDGES, NODE_LOOKUP } from "@/data";
import { WorkflowCanvas, NodePalette, WorkflowsBrowser, PropertiesPanel } from "@/workflows";

export function WorkflowsView({ tw }: { tw: any }) {
  const [nodes, setNodes] = useState(STARTER_NODES);
  const [edges] = useState(STARTER_EDGES);
  const [selectedId, setSelectedId] = useState("n3");
  const [tab, setTab] = useState("canvas");
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [runState, setRunState] = useState<{ active: string[]; done: string[] }>({ active: [], done: [] });

  useEffect(() => {
    if (!running) return;
    const order = ["n1", "n2", "n3", "n4", "n5", "n6", "n7", "n8"];
    let i = 0;
    const done: string[] = [];
    const tick = () => {
      if (i >= order.length) { setRunning(false); setRunState({ active: [], done: order }); return; }
      const id = order[i]!;
      setRunState({ active: [id], done: [...done] });
      done.push(id); i++;
      setTimeout(tick, 900);
    };
    tick();
  }, [running]);

  const onDragStart = (e: React.DragEvent, type: string) => e.dataTransfer.setData("node/type", type);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("node/type");
    if (!type) return;
    const def = NODE_LOOKUP[type];
    if (!def) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const id = "n" + (nodes.length + 1);
    setNodes((ns) => [...ns, { id, type, x: e.clientX - r.left, y: e.clientY - r.top, label: def.label, subtitle: def.desc }]);
  };

  const sel = nodes.find((n) => n.id === selectedId);
  const patch = (p: any) => setNodes((ns) => ns.map((n) => n.id === selectedId ? { ...n, ...p } : n));

  return (
    <div className="wf-view">
      <NodePalette onDragStart={onDragStart} query={query} setQuery={setQuery} />
      <WorkflowsBrowser activeTab={tab} setActiveTab={setTab} />
      <div className="split-pane" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="wf-toolbar">
          <div className="pill mono">Simple Component</div>
          <div style={{ flex: 1 }} />
          <button className="btn"><Icons.save size={12} /> Save</button>
          <button className={running ? "btn" : "btn btn--acc"} onClick={() => setRunning(!running)}>
            {running ? <><Icons.stop size={11} /> Stop</> : <><Icons.play size={11} /> Run</>}
          </button>
        </div>
        <WorkflowCanvas
          nodes={nodes} setNodes={setNodes} edges={edges}
          selectedId={selectedId} setSelectedId={setSelectedId}
          running={running} runState={runState}
          edgeStyle={tw.edgeStyle}
        />
      </div>
      <PropertiesPanel node={sel} onPatch={patch} />
    </div>
  );
}
