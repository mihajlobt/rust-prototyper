import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ProjectSettings } from "@/stores/projectSettingsStore";

interface DirectoriesTabProps {
  ps: ProjectSettings;
  setProjectSettings: (patch: Partial<ProjectSettings>) => void;
}

const FIXED_PATHS = [
  { label: "Components",   path: "generated/src/components/{name}/component.tsx" },
  { label: "Screens",      path: "generated/src/pages/{name}.tsx" },
  { label: "Active theme", path: "generated/src/styles/preview-theme.css" },
] as const;

const DEFAULT_THEMES_DIR = "src/styles/themes";

export function DirectoriesTab({ ps, setProjectSettings }: DirectoriesTabProps) {
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-6">

        {/* Fixed paths — read-only reference */}
        <section className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project paths</p>
          <p className="text-xs text-muted-foreground">Fixed paths inside the generated Vite project where files are written.</p>
          <div className="rounded-lg border border-border overflow-hidden">
            {FIXED_PATHS.map(({ label, path }, i, arr) => (
              <div key={label} className={`flex items-center gap-4 px-3 py-2.5 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                <span className="text-sm text-muted-foreground w-28 shrink-0">{label}</span>
                <code className="text-xs font-mono text-foreground/80">{path}</code>
              </div>
            ))}
          </div>
        </section>

        {/* Theme export path — the one actually configurable setting */}
        <section className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Theme export path</p>
          <p className="text-xs text-muted-foreground">
            Where <strong>Save to Runner</strong> in the Themes panel writes exported CSS files, relative to <code className="text-[11px] bg-muted px-1 py-0.5 rounded">generated/</code>.
          </p>
          <div className="space-y-1.5">
            <Input
              value={ps.directories.themes}
              onChange={(e) => setProjectSettings({ directories: { ...ps.directories, themes: e.target.value } })}
              placeholder="src/styles/themes"
              className="font-mono text-xs max-w-xs"
            />
            <p className="text-[10px] text-muted-foreground font-mono">
              generated/{ps.directories.themes || "…"}/{"{name}"}.css
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setProjectSettings({ directories: { ...ps.directories, themes: DEFAULT_THEMES_DIR } })}
            disabled={ps.directories.themes === DEFAULT_THEMES_DIR}
          >
            Reset to default
          </Button>
        </section>

        {/* Runner port */}
        <section className="space-y-3 border-t border-border pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Dev Server</p>
          <div className="flex items-center gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="runnerPort" className="text-sm">Runner port</Label>
              <Input
                id="runnerPort"
                type="number"
                min={1024}
                max={65535}
                value={ps.runnerPort}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  if (!isNaN(val) && val >= 1024 && val <= 65535) setProjectSettings({ runnerPort: val });
                }}
                className="h-8 text-xs w-28"
              />
            </div>
            <p className="text-xs text-muted-foreground pt-5">Restart the dev server for port changes to take effect.</p>
          </div>
        </section>

      </div>
    </ScrollArea>
  );
}
