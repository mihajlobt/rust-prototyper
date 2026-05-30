import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Navigation, Database, Circle, MousePointerClick, ChevronRight, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateScreenPorts, type NavPort } from "@/lib/navigation";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface PortsEditorProps {
  screenId: string;
  projectDir: string;
  ports: NavPort[];
  onPortsChange: (ports: NavPort[]) => void;
  onSelectElement?: () => void;
  isSelectingElement?: boolean;
}

function PortRow({
  port,
  onRename,
  onDelete,
  onTypeChange,
}: {
  port: NavPort;
  onRename: (name: string) => void;
  onDelete: () => void;
  onTypeChange: (type: "navigation" | "data") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(port.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const isInput = port.direction === "input";

  useEffect(() => { setDraft(port.name); }, [port.name]);

  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft !== port.name) onRename(draft.trim());
    else setDraft(port.name);
  };

  const dotColor = port.type === "data" ? "text-emerald-400" : "text-primary";
  const typeIcon = port.type === "data"
    ? <Database size={13} className="text-emerald-400" />
    : <Navigation size={13} className="text-primary" />;

  return (
    <div className="group flex items-center gap-2 px-2.5 py-1.5 rounded hover:bg-muted/50 transition-colors">
      {/* Direction indicator dot */}
      <div className={cn("shrink-0", isInput ? "order-first" : "order-last")}>
        <Circle size={11} className={cn("fill-current", dotColor)} />
      </div>

      {/* Direction label */}
      <span className={cn(
        "text-[11px] font-mono font-semibold uppercase shrink-0 w-8",
        isInput ? "text-blue-400" : "text-amber-400"
      )}>
        {isInput ? "IN" : "OUT"}
      </span>

      {/* Name — click to edit */}
      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setDraft(port.name); } }}
          className="h-6 text-xs flex-1 px-1.5 py-0"
          autoFocus
        />
      ) : (
        <button
          className="flex-1 text-left text-xs truncate text-foreground/90 hover:text-foreground"
          onClick={() => { setEditing(true); setTimeout(() => inputRef.current?.select(), 0); }}
          title={port.name}
        >
          {port.name}
        </button>
      )}

      {/* Type toggle */}
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={() => onTypeChange(port.type === "data" ? "navigation" : "data")}
        title={`Type: ${port.type} — click to toggle`}
      >
        {typeIcon}
      </button>

      {/* Delete */}
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

export function PortsEditor({ screenId, projectDir, ports, onPortsChange, onSelectElement, isSelectingElement }: PortsEditorProps) {
  const [localPorts, setLocalPorts] = useState<NavPort[]>(ports);
  const [isSaving, setIsSaving] = useState(false);
  const [inputsOpen, setInputsOpen] = useState(true);
  const [outputsOpen, setOutputsOpen] = useState(true);

  useEffect(() => { setLocalPorts(ports); }, [ports]);

  const savePorts = async (newPorts: NavPort[]) => {
    setIsSaving(true);
    try {
      await updateScreenPorts(projectDir, screenId, newPorts);
      onPortsChange(newPorts);
      window.dispatchEvent(new Event("navigation-changed"));
    } catch (e) {
      notify.error("Failed to save ports", getErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  };

  const addPort = (direction: "input" | "output") => {
    const id = `${screenId}:${direction}-${Date.now()}`;
    const newPort: NavPort = { id, name: direction === "input" ? "New Input" : "New Output", direction, type: "navigation", schema: "{}" };
    const newPorts = [...localPorts, newPort];
    setLocalPorts(newPorts);
    savePorts(newPorts);
  };

  const updatePort = (id: string, updates: Partial<NavPort>) => {
    const newPorts = localPorts.map((p) => (p.id === id ? { ...p, ...updates } : p));
    setLocalPorts(newPorts);
    savePorts(newPorts);
  };

  const deletePort = (id: string) => {
    const newPorts = localPorts.filter((p) => p.id !== id);
    setLocalPorts(newPorts);
    savePorts(newPorts);
  };

  const inputPorts = localPorts.filter((p) => p.direction === "input");
  const outputPorts = localPorts.filter((p) => p.direction === "output");

  const SectionHeader = ({ label, count, open, onToggle, onAdd, accent }: {
    label: string; count: number; open: boolean; onToggle: () => void; onAdd: () => void; accent: string;
  }) => (
    <div className="flex items-center gap-1.5 px-2.5 py-1">
      <button className="flex items-center gap-1.5 flex-1 min-w-0" onClick={onToggle}>
        {open
          ? <ChevronDown size={13} className="text-muted-foreground shrink-0" />
          : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
        <span className={cn("text-[11px] font-semibold uppercase tracking-widest", accent)}>{label}</span>
        <span className="ml-1 text-[11px] text-muted-foreground/60">{count}</span>
      </button>
      <button
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        onClick={onAdd}
        title={`Add ${label.toLowerCase()} port`}
      >
        <Plus size={14} />
      </button>
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50">
        <span className="text-xs font-semibold text-foreground/80 uppercase tracking-wider">Screen Ports</span>
        <div className="flex items-center gap-1.5">
          {onSelectElement && (
            <Button
              variant={isSelectingElement ? "secondary" : "ghost"}
              size="sm"
              className={cn("h-6 text-xs gap-1.5 px-2", isSelectingElement && "bg-cyan-500/20 text-cyan-400 border border-cyan-500/30")}
              onClick={onSelectElement}
            >
              <MousePointerClick size={12} />
              {isSelectingElement ? "Selecting…" : "Pick element"}
            </Button>
          )}
          {isSaving && <span className="text-xs text-muted-foreground animate-pulse">saving…</span>}
        </div>
      </div>

      {isSelectingElement && (
        <div className="mx-2 mt-2 px-2.5 py-2 rounded bg-cyan-500/10 border border-cyan-500/20 text-xs text-cyan-300">
          Click any element in the preview to pin a hotspot port to it
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {/* Inputs */}
        <SectionHeader
          label="Inputs"
          count={inputPorts.length}
          open={inputsOpen}
          onToggle={() => setInputsOpen((v) => !v)}
          onAdd={() => addPort("input")}
          accent="text-blue-400"
        />
        {inputsOpen && (
          <div className="mb-1">
            {inputPorts.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 px-4 py-1 italic">No input ports</p>
            ) : inputPorts.map((port) => (
              <PortRow
                key={port.id}
                port={port}
                onRename={(name) => updatePort(port.id, { name })}
                onDelete={() => deletePort(port.id)}
                onTypeChange={(type) => updatePort(port.id, { type })}
              />
            ))}
          </div>
        )}

        {/* Outputs */}
        <SectionHeader
          label="Outputs"
          count={outputPorts.length}
          open={outputsOpen}
          onToggle={() => setOutputsOpen((v) => !v)}
          onAdd={() => addPort("output")}
          accent="text-amber-400"
        />
        {outputsOpen && (
          <div className="mb-1">
            {outputPorts.length === 0 ? (
              <p className="text-xs text-muted-foreground/50 px-4 py-1 italic">No output ports</p>
            ) : outputPorts.map((port) => (
              <PortRow
                key={port.id}
                port={port}
                onRename={(name) => updatePort(port.id, { name })}
                onDelete={() => deletePort(port.id)}
                onTypeChange={(type) => updatePort(port.id, { type })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
