import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Plus, Trash2, Loader2, Layout, Box, Palette, Workflow, Globe, CheckCircle2 } from "lucide-react";
import { readDir, createDir, writeFile, deleteDir, readFile, runShellCommandCapture, getErrorMessage } from "@/lib/ipc";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useSettings } from "@/hooks/useSettings";
import { scaffoldGenerated } from "@/lib/scaffold";
import { designLanguageSpecSchema } from "@/lib/design/spec";
import * as z from "zod/v4";
import { notify } from "@/hooks/useToast";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { initRepo } from "@/lib/git/repo";
import { commit } from "@/lib/git/commit";

interface ProjectMeta {
  id: string;
  /** Display name from project.json, falls back to id */
  name: string;
  created: string | null;
  updated: string | null;
  counts: {
    screens: number;
    components: number;
    themes: number;
    workflows: number;
    apis: number;
  };
}

const PROJECTS_DIR = "projects";

async function loadProjectMeta(id: string): Promise<ProjectMeta> {
  const base = `${PROJECTS_DIR}/${id}`;
  let name = id;
  let created: string | null = null;
  let updated: string | null = null;

  try {
    const raw = await readFile(`${base}/project.json`);
    const json = JSON.parse(raw) as { name?: string; created?: string; updated?: string };
    name = json.name || id;
    created = json.created ?? null;
    updated = json.updated ?? null;
  } catch {
    // project.json missing — use id as name
  }

  async function countDir(section: string): Promise<number> {
    try {
      const entries = await readDir(`${base}/${section}`);
      return entries.length;
    } catch {
      return 0;
    }
  }

  const [screens, components, themes, workflows, apis] = await Promise.all([
    countDir("screens"),
    countDir("components"),
    countDir("themes"),
    countDir("workflows"),
    countDir("apis"),
  ]);

  return { id, name, created, updated, counts: { screens, components, themes, workflows, apis } };
}

export function ProjectManagerModal() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [scaffolding, setScaffolding] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await readDir(PROJECTS_DIR);
      const dirs = entries.filter(
        (e) => e.is_dir && e.name !== "__placeholder__"
      );
      const metas = await Promise.all(dirs.map((e) => loadProjectMeta(e.name)));
      // Active project first, then alphabetical
      metas.sort((a, b) => {
        if (a.id === settings.project) return -1;
        if (b.id === settings.project) return 1;
        return a.name.localeCompare(b.name);
      });
      setProjects(metas);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, [settings.project]);

  useEffect(() => {
    if (open) loadProjects();
  }, [open, loadProjects]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    const id = newProjectName.toLowerCase().replace(/\s+/g, "-");
    const projectPath = `${PROJECTS_DIR}/${id}`;
    const now = new Date().toISOString();
    await createDir(projectPath);
    await createDir(`${projectPath}/screens`);
    await createDir(`${projectPath}/components`);
    await createDir(`${projectPath}/themes`);
    await createDir(`${projectPath}/workflows`);
    await createDir(`${projectPath}/apis`);
    await createDir(`${projectPath}/generated`);
    await writeFile(
      `${projectPath}/project.json`,
      JSON.stringify({ name: newProjectName, created: now, updated: now }, null, 2)
    );
    await writeFile(
      `${projectPath}/themes/design-schema.json`,
      JSON.stringify(z.toJSONSchema(designLanguageSpecSchema), null, 2)
    );

    setScaffolding(true);
    try {
      await withScaffoldNotifications(
        "scaffold-generated",
        `Creating project "${newProjectName}"`,
        (onStep) => scaffoldGenerated(`${projectPath}/generated`, settings.iconLibrary, onStep)
      );
    } catch {
      // withScaffoldNotifications shows the error toast
    } finally {
      setScaffolding(false);
    }

    try {
      const generatedPath = `${projectPath}/generated`;
      await initRepo(generatedPath);
      await runShellCommandCapture(generatedPath, "git add -A");
      await commit(generatedPath, "Initial project scaffold");
    } catch (e) {
      notify.error("Git init failed", getErrorMessage(e));
    }

    setNewProjectName("");
    await loadProjects();
  };

  const deleteProject = async (id: string) => {
    if (id === settings.project) {
      notify.error("Cannot delete active project", "Switch to another project first");
      return;
    }
    if (!(await confirm(`Delete project "${id}"? This cannot be undone.`, { title: "Delete Project", kind: "warning" }))) return;
    try {
      await deleteDir(`${PROJECTS_DIR}/${id}`);
      await loadProjects();
    } catch (e) {
      notify.error("Delete failed", getErrorMessage(e));
    }
  };

  const switchProject = async (id: string) => {
    await setSettings({ project: id });
    setOpen(false);
  };

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
          <Folder size={12} />
          {settings.project || "default"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl h-[80vh] overflow-hidden flex flex-col gap-4">
        <DialogTitle className="shrink-0">Projects</DialogTitle>
        {/* Create */}
        <div className="flex gap-2 shrink-0">
          <Input
            placeholder="New project name..."
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createProject()}
            autoFocus
          />
          <Button onClick={createProject} disabled={!newProjectName.trim() || scaffolding} className="gap-1.5">
            {scaffolding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {scaffolding ? "Creating…" : "Create"}
          </Button>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-2 space-y-2">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground gap-2">
              <Loader2 size={16} className="animate-spin" />
              <span className="text-sm">Loading projects…</span>
            </div>
          )}
          {!loading && projects.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              No projects yet. Create one above.
            </div>
          )}
          {projects.map((project) => {
            const active = project.id === settings.project;
            const total = Object.values(project.counts).reduce((s, n) => s + n, 0);
            return (
              <div
                key={project.id}
                className={[
                  "rounded-lg border p-3 transition-colors",
                  active ? "border-primary/50 bg-primary/5" : "border-border bg-card hover:bg-muted/40",
                ].join(" ")}
              >
                <div className="flex items-start gap-3">
                  {/* Main info */}
                  <button className="flex-1 text-left min-w-0" onClick={() => switchProject(project.id)}>
                    <div className="flex items-center gap-2 mb-2">
                      {active && <CheckCircle2 size={15} className="text-primary shrink-0" />}
                      <span className="text-base font-semibold truncate">{project.name}</span>
                      {project.name !== project.id && (
                        <span className="text-xs text-muted-foreground font-mono truncate">{project.id}</span>
                      )}
                      {active && (
                        <span className="ml-auto text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium shrink-0">
                          active
                        </span>
                      )}
                    </div>

                    {/* Asset counts */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      {total === 0 ? (
                        <span>Empty project</span>
                      ) : (
                        <>
                          {project.counts.screens > 0 && (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Layout size={12} />
                              {project.counts.screens} screen{project.counts.screens !== 1 ? "s" : ""}
                            </span>
                          )}
                          {project.counts.components > 0 && (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Box size={12} />
                              {project.counts.components} component{project.counts.components !== 1 ? "s" : ""}
                            </span>
                          )}
                          {project.counts.themes > 0 && (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Palette size={12} />
                              {project.counts.themes} theme{project.counts.themes !== 1 ? "s" : ""}
                            </span>
                          )}
                          {project.counts.workflows > 0 && (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Workflow size={12} />
                              {project.counts.workflows} workflow{project.counts.workflows !== 1 ? "s" : ""}
                            </span>
                          )}
                          {project.counts.apis > 0 && (
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <Globe size={12} />
                              {project.counts.apis} API{project.counts.apis !== 1 ? "s" : ""}
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    {/* Dates */}
                    {project.created && (
                      <div className="text-xs text-muted-foreground/60 mt-1.5">
                        Created {formatDate(project.created)}
                        {project.updated && project.updated !== project.created && (
                          <> · Updated {formatDate(project.updated)}</>
                        )}
                      </div>
                    )}
                  </button>

                  {/* Actions */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => deleteProject(project.id)}
                    disabled={active}
                    title={active ? "Cannot delete active project" : `Delete ${project.name}`}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
      </Dialog>
  );
}
