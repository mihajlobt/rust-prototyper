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
import { useAppStore } from "@/stores/appStore";
import { useSaveComponent } from "@/hooks/useProjectFiles";

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
  const { settings } = useAppStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const saveMutation = useSaveComponent();

  const handleSave = async () => {
    if (!name.trim()) return;
    const id = name.toLowerCase().replace(/\s+/g, "-");
    await saveMutation.mutateAsync({
      project: settings.project,
      name: id,
      code,
      messages,
    });
    setOpen(false);
    setName("");
    onSaved?.(id);
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
          <Button className="w-full" onClick={handleSave} disabled={saveMutation.isPending || !name.trim()}>
            {saveMutation.isPending ? "Saving…" : "Save to Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
