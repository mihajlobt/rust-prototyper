import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download, FileArchive, Info } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { exportProject, getErrorMessage } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { notify } from "@/hooks/useToast";

export function ExportModal() {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      const outputPath = await save({
        filters: [{ name: "Zip", extensions: ["zip"] }],
        defaultPath: `${settings.project}-export.zip`,
      });
      if (!outputPath) return;
      await exportProject(settings.project, outputPath, "react", false, false, false, false);
      notify.success("Export complete", outputPath);
      setOpen(false);
    } catch (e) {
      notify.error("Export failed", getErrorMessage(e));
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
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Export Project</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            <span>
              Exports the scaffolded <code className="font-mono">generated/</code> project as a runnable zip.
              Includes router, services, Vite proxy config, and a <code className="font-mono">.env.example</code>.
              API keys are <strong>not</strong> included.
              Run <code className="font-mono">bun install &amp;&amp; bun dev</code> after unzipping.
            </span>
          </div>

          <Button className="w-full gap-1" onClick={handleExport} disabled={exporting}>
            <FileArchive size={14} />
            {exporting ? "Exporting…" : "Export as Zip"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
