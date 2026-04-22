import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Download, FileCode } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportComponent } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

interface ComponentExportModalProps {
  componentId?: string;
  trigger?: React.ReactNode;
}

export function ComponentExportModal({ componentId, trigger }: ComponentExportModalProps) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("tsx");
  const [includeTypes, setIncludeTypes] = useState(true);
  const [includeStorybook, setIncludeStorybook] = useState(false);
  const [includeTests, setIncludeTests] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!componentId) return;
    setExporting(true);
    try {
      const outputPath = await save({
        filters: [{ name: "Zip", extensions: ["zip"] }],
        defaultPath: `${componentId}-component.zip`,
      });
      if (!outputPath) {
        setExporting(false);
        return;
      }
      const path = await exportComponent(
        settings.project,
        componentId,
        outputPath,
        format,
        includeTypes,
        includeStorybook,
        includeTests
      );
      alert(`Exported to: ${path}`);
      setOpen(false);
    } catch (e) {
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <Download size={12} />
            Export
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Component</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Format</Label>
            <div className="flex gap-2">
              {["tsx", "jsx", "vue", "svelte"].map((f) => (
                <Button
                  key={f}
                  variant={format === f ? "default" : "outline"}
                  size="sm"
                  className="text-xs capitalize"
                  onClick={() => setFormat(f)}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Options</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="types" checked={includeTypes} onCheckedChange={(c) => setIncludeTypes(c === true)} />
                <Label htmlFor="types" className="text-sm font-normal">Type definitions</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="storybook" checked={includeStorybook} onCheckedChange={(c) => setIncludeStorybook(c === true)} />
                <Label htmlFor="storybook" className="text-sm font-normal">Storybook</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="tests" checked={includeTests} onCheckedChange={(c) => setIncludeTests(c === true)} />
                <Label htmlFor="tests" className="text-sm font-normal">Tests</Label>
              </div>
            </div>
          </div>
          <Button className="w-full gap-1" onClick={handleExport} disabled={exporting || !componentId}>
            <FileCode size={14} />
            {exporting ? "Exporting…" : "Export Component"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
