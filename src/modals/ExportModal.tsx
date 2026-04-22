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
import { Download, FileArchive } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportProject } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

export function ExportModal() {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState("react");
  const [includeApis, setIncludeApis] = useState(true);
  const [includeTheme, setIncludeTheme] = useState(true);
  const [includeComponents, setIncludeComponents] = useState(true);
  const [includeTests, setIncludeTests] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const outputPath = await save({
        filters: [{ name: "Zip", extensions: ["zip"] }],
        defaultPath: `${settings.project}-export.zip`,
      });
      if (!outputPath) {
        setExporting(false);
        return;
      }
      const path = await exportProject(
        settings.project,
        outputPath,
        format,
        includeApis,
        includeTheme,
        includeComponents,
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
        <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
          <Download size={12} />
          Export
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Framework</Label>
            <div className="flex gap-2">
              {["react", "vue", "svelte", "solid"].map((f) => (
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
            <Label>Include</Label>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Checkbox id="apis" checked={includeApis} onCheckedChange={(c) => setIncludeApis(c === true)} />
                <Label htmlFor="apis" className="text-sm font-normal">APIs</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="theme" checked={includeTheme} onCheckedChange={(c) => setIncludeTheme(c === true)} />
                <Label htmlFor="theme" className="text-sm font-normal">Theme</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="components" checked={includeComponents} onCheckedChange={(c) => setIncludeComponents(c === true)} />
                <Label htmlFor="components" className="text-sm font-normal">Components</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="tests" checked={includeTests} onCheckedChange={(c) => setIncludeTests(c === true)} />
                <Label htmlFor="tests" className="text-sm font-normal">Tests</Label>
              </div>
            </div>
          </div>

          <Button className="w-full gap-1" onClick={handleExport} disabled={exporting}>
            <FileArchive size={14} />
            {exporting ? "Exporting…" : "Export Project"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
