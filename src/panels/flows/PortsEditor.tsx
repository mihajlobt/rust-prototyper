import { useState, useEffect } from "react";
import { Plus, Trash2, ArrowDown, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateScreenPorts, type NavPort } from "@/lib/navigation";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";

interface PortsEditorProps {
  screenId: string;
  projectDir: string;
  ports: NavPort[];
  onPortsChange: (ports: NavPort[]) => void;
}

export function PortsEditor({ screenId, projectDir, ports, onPortsChange }: PortsEditorProps) {
  const [localPorts, setLocalPorts] = useState<NavPort[]>(ports);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setLocalPorts(ports);
  }, [ports]);

  const savePorts = async (newPorts: NavPort[]) => {
    setIsSaving(true);
    try {
      await updateScreenPorts(projectDir, screenId, newPorts);
      onPortsChange(newPorts);
    } catch (e) {
      notify.error("Failed to save ports", getErrorMessage(e));
    } finally {
      setIsSaving(false);
    }
  };

  const addPort = (direction: "input" | "output") => {
    const id = `${screenId}:${direction}-${Date.now()}`;
    const newPort: NavPort = {
      id,
      name: direction === "input" ? "New Input" : "New Output",
      direction,
      type: "navigation",
      schema: "{}",
    };
    const newPorts = [...localPorts, newPort];
    setLocalPorts(newPorts);
    savePorts(newPorts);
  };

  const updatePort = (index: number, updates: Partial<NavPort>) => {
    const newPorts = localPorts.map((p, i) => (i === index ? { ...p, ...updates } : p));
    setLocalPorts(newPorts);
  };

  const deletePort = (index: number) => {
    const newPorts = localPorts.filter((_, i) => i !== index);
    setLocalPorts(newPorts);
    savePorts(newPorts);
  };

  const saveAll = () => {
    savePorts(localPorts);
  };

  const inputPorts = localPorts.filter((p) => p.direction === "input");
  const outputPorts = localPorts.filter((p) => p.direction === "output");

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Screen Ports</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={saveAll}
          disabled={isSaving}
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <ArrowDown size={10} className="text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase">Inputs</span>
          <Button variant="ghost" size="icon" className="h-4 w-4 ml-auto" onClick={() => addPort("input")}>
            <Plus size={10} />
          </Button>
        </div>
        {inputPorts.map((port) => {
          const globalIdx = localPorts.findIndex((p) => p.id === port.id);
          return (
            <div key={port.id} className="flex items-center gap-1">
              <Input
                className="h-6 text-[10px] flex-1"
                value={port.name}
                onChange={(e) => updatePort(globalIdx, { name: e.target.value })}
                onBlur={saveAll}
              />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deletePort(globalIdx)}>
                <Trash2 size={10} />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-1">
          <ArrowRight size={10} className="text-muted-foreground" />
          <span className="text-[10px] text-muted-foreground uppercase">Outputs</span>
          <Button variant="ghost" size="icon" className="h-4 w-4 ml-auto" onClick={() => addPort("output")}>
            <Plus size={10} />
          </Button>
        </div>
        {outputPorts.map((port) => {
          const globalIdx = localPorts.findIndex((p) => p.id === port.id);
          return (
            <div key={port.id} className="flex items-center gap-1">
              <Input
                className="h-6 text-[10px] flex-1"
                value={port.name}
                onChange={(e) => updatePort(globalIdx, { name: e.target.value })}
                onBlur={saveAll}
              />
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => deletePort(globalIdx)}>
                <Trash2 size={10} />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
