import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { readFile, writeFile, bunInstall, getErrorMessage } from "@/lib/ipc";
import { ICON_LIBRARY_PACKAGES } from "@/lib/prompts";
import { StylesEditor } from "@/modals/StylesEditor";
import { GeneralTab } from "@/modals/settings/GeneralTab";
import { AITab } from "@/modals/settings/AITab";
import { AgentsTab } from "@/modals/settings/AgentsTab";
import { DirectoriesTab } from "@/modals/settings/DirectoriesTab";
import { PromptsTab } from "@/modals/settings/PromptsTab";

export function SettingsModal() {
  const { settings, setSettings } = useSettings();
  const { ps, setProjectSettings } = useProjectSettingsStore();
  const [open, setOpen] = useState(false);

  // Auto-install icon library when changed
  useEffect(() => {
    if (!settings.project) return;
    const iconLib = settings.iconLibrary;
    (async () => {
      try {
        const pkgPath = `projects/${settings.project}/generated/package.json`;
        let pkg: Record<string, unknown> = { dependencies: {} };
        try {
          const existing = await readFile(pkgPath);
          pkg = JSON.parse(existing);
        } catch {
          // create new
        }
        const deps = (pkg.dependencies as Record<string, string>) || {};

        // Remove all icon library packages
        const allIconPackages = Object.values(ICON_LIBRARY_PACKAGES).filter(Boolean);
        let changed = false;
        for (const pkgName of allIconPackages) {
          if (deps[pkgName]) {
            delete deps[pkgName];
            changed = true;
          }
        }

        // Add selected icon library package
        const selectedPkg = ICON_LIBRARY_PACKAGES[iconLib];
        if (selectedPkg) {
          deps[selectedPkg] = "latest";
          changed = true;
        }

        if (changed) {
          pkg.dependencies = deps;
          await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
          await bunInstall(`./projects/${settings.project}/generated`);
        }
      } catch (e) {
        notify.error("Icon library install failed", getErrorMessage(e));
      }
    })();
  }, [settings.iconLibrary, settings.project]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="general" className="text-[11px]">General</TabsTrigger>
            <TabsTrigger value="ai" className="text-[11px]">AI</TabsTrigger>
            <TabsTrigger value="agents" className="text-[11px]">Agents</TabsTrigger>
            <TabsTrigger value="directories" className="text-[11px]">Directories</TabsTrigger>
            <TabsTrigger value="styles" className="text-[11px]">Styles</TabsTrigger>
            <TabsTrigger value="prompts" className="text-[11px]">Prompts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <GeneralTab settings={settings} setSettings={setSettings} />
          </TabsContent>

          <TabsContent value="ai" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <AITab settings={settings} setSettings={setSettings} />
          </TabsContent>

          <TabsContent value="agents" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <AgentsTab settings={settings} setSettings={setSettings} />
          </TabsContent>

          <TabsContent value="directories" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <DirectoriesTab ps={ps} setProjectSettings={setProjectSettings} />
          </TabsContent>

          <TabsContent value="styles" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <StylesEditor />
          </TabsContent>

          <TabsContent value="prompts" className="flex-1 mt-4 overflow-hidden flex flex-col">
            <PromptsTab settings={settings} setSettings={setSettings} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
