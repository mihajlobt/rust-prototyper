import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Plus, Trash2, Loader2 } from "lucide-react";
import { readDir, createDir, writeFile, deleteDir } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

interface Project {
  id: string;
  name: string;
  path: string;
}

const PROJECTS_DIR = "./projects";

export function ProjectManagerModal() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const entries = await readDir(PROJECTS_DIR);
      const list: Project[] = [];
      for (const entry of entries) {
        if (entry.is_dir) {
          list.push({
            id: entry.name,
            name: entry.name,
            path: entry.path,
          });
        }
      }
      setProjects(list);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) loadProjects();
  }, [open, loadProjects]);

  const createProject = async () => {
    if (!newProjectName.trim()) return;
    const id = newProjectName.toLowerCase().replace(/\s+/g, "-");
    const projectPath = `${PROJECTS_DIR}/${id}`;
    await createDir(projectPath);
    await createDir(`${projectPath}/screens`);
    await createDir(`${projectPath}/components`);
    await createDir(`${projectPath}/themes`);
    await createDir(`${projectPath}/workflows`);
    await createDir(`${projectPath}/apis`);
    await createDir(`${projectPath}/generated`);
    await writeFile(
      `${projectPath}/project.json`,
      JSON.stringify({ name: newProjectName, created: new Date().toISOString(), updated: new Date().toISOString() }, null, 2)
    );
    setNewProjectName("");
    await loadProjects();
  };

  const deleteProject = async (id: string) => {
    if (!confirm(`Delete project "${id}"?`)) return;
    try {
      await deleteDir(`${PROJECTS_DIR}/${id}`);
      await loadProjects();
    } catch {
      // ignore
    }
  };

  const switchProject = async (id: string) => {
    await setSettings({ project: id });
    setOpen(false);
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7">
          <Folder size={12} />
          {settings.project || "default"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Project Manager</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="New project name..."
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
            />
            <Button onClick={createProject} disabled={!newProjectName.trim()}>
              <Plus size={14} />
            </Button>
          </div>

          <div className="space-y-1 max-h-[300px] overflow-auto">
            {loading && (
              <div className="flex items-center justify-center py-4 text-muted-foreground">
                <Loader2 size={16} className="animate-spin mr-2" />
                Loading projects...
              </div>
            )}
            {projects.length === 0 && !loading && (
              <div className="text-sm text-muted-foreground text-center py-4">
                No projects yet. Create one above.
              </div>
            )}
            {projects.map((project) => {
              const active = project.id === settings.project;
              return (
                <div
                  key={project.id}
                  className={[
                    "flex items-center justify-between p-2 rounded border",
                    active
                      ? "bg-accent border-accent"
                      : "bg-card border-border",
                  ].join(" ")}
                >
                  <button
                    className="flex-1 text-left text-sm font-medium"
                    onClick={() => switchProject(project.id)}
                  >
                    {project.name}
                    {active && (
                      <span className="ml-2 text-xs text-muted-foreground">(active)</span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-destructive"
                    onClick={() => deleteProject(project.id)}
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
