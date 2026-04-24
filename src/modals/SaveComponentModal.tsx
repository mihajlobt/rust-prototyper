import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save } from "lucide-react";
import { writeFile, createDir } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface SaveComponentModalProps {
  code: string;
  prompt: string;
  messages?: ChatMessage[];
  trigger?: React.ReactNode;
  onSaved?: (id: string) => void;
}

export function SaveComponentModal({ code, prompt, messages, trigger, onSaved }: SaveComponentModalProps) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const id = name.toLowerCase().replace(/\s+/g, "-");
      const base = `projects/${settings.project}/components/${id}`;
      await createDir(base);
      await writeFile(`${base}/component.tsx`, code);
      await writeFile(`${base}/prompt.json`, JSON.stringify({ name, prompt, created: new Date().toISOString() }, null, 2));
      if (messages && messages.length > 0) {
        await writeFile(`${base}/chat.json`, JSON.stringify(messages, null, 2));
      }
      setOpen(false);
      setName("");
      onSaved?.(id);
    } catch (e) {
      alert(`Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1 text-sm">
            <Save size={14} />
            Save
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Save Component</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="comp-name">Name</Label>
            <Input
              id="comp-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="MyComponent"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="comp-prompt">Prompt</Label>
            <Textarea
              id="comp-prompt"
              value={prompt}
              readOnly
              className="min-h-[80px] text-sm"
            />
          </div>
          <Button className="w-full" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? "Saving…" : "Save to Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
