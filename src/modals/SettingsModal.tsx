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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Plus, Trash2 } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";

export function SettingsModal() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetValue, setNewPresetValue] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptValue, setNewPromptValue] = useState("");

  const addPreset = async () => {
    if (!newPresetName || !newPresetValue) return;
    const next = [...settings.styles, { name: newPresetName, value: newPresetValue }];
    await setSettings({ styles: next });
    setNewPresetName("");
    setNewPresetValue("");
  };

  const removePreset = async (index: number) => {
    const next = settings.styles.filter((_, i) => i !== index);
    await setSettings({ styles: next });
  };

  const addPrompt = async () => {
    if (!newPromptName || !newPromptValue) return;
    const next = { ...settings.prompts, [newPromptName]: newPromptValue };
    await setSettings({ prompts: next });
    setNewPromptName("");
    setNewPromptValue("");
  };

  const removePrompt = async (name: string) => {
    const next = { ...settings.prompts };
    delete next[name];
    await setSettings({ prompts: next });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="styles">Styles</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Input
                id="project"
                value={settings.project}
                onChange={(e) => setSettings({ project: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stylePreset">Default Style Preset</Label>
              <Input
                id="stylePreset"
                value={settings.stylePreset}
                onChange={(e) => setSettings({ stylePreset: e.target.value })}
              />
            </div>
          </TabsContent>

          <TabsContent value="ai" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="host">Ollama Host</Label>
              <Input
                id="host"
                value={settings.host}
                onChange={(e) => setSettings({ host: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modelId">Default Model</Label>
              <Input
                id="modelId"
                value={settings.modelId}
                onChange={(e) => setSettings({ modelId: e.target.value })}
                placeholder="qwen2.5-coder:32b"
              />
            </div>
            <div className="space-y-2">
              <Label>API Keys</Label>
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="OpenAI API Key"
                  value={settings.apiKeys.openai || ""}
                  onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, openai: e.target.value } })}
                />
                <Input
                  type="password"
                  placeholder="Claude API Key"
                  value={settings.apiKeys.claude || ""}
                  onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, claude: e.target.value } })}
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="styles" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label>New Style Preset</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Name"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                />
                <Input
                  placeholder="Value"
                  value={newPresetValue}
                  onChange={(e) => setNewPresetValue(e.target.value)}
                />
                <Button size="sm" onClick={addPreset}>
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              {settings.styles.map((preset, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded bg-muted">
                  <span className="text-sm">{preset.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePreset(i)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="prompts" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label>New Prompt Template</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Name"
                  value={newPromptName}
                  onChange={(e) => setNewPromptName(e.target.value)}
                />
                <Button size="sm" onClick={addPrompt}>
                  <Plus size={14} />
                </Button>
              </div>
              <Textarea
                placeholder="Prompt template value..."
                value={newPromptValue}
                onChange={(e) => setNewPromptValue(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {Object.entries(settings.prompts).map(([name, value]) => (
                <div key={name} className="flex items-start justify-between p-2 rounded bg-muted gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{value as string}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removePrompt(name)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
