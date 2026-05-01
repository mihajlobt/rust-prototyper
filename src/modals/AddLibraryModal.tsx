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
import { PackagePlus } from "lucide-react";
import { readFile, writeFile, bunInstall, getErrorMessage } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";

const NPM_NAME_REGEX = /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

interface AddLibraryModalProps {
  onAdded?: () => void;
  trigger?: React.ReactNode;
}

export function AddLibraryModal({ onAdded, trigger }: AddLibraryModalProps) {
  const { settings } = useSettings();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");

  const handleAdd = async () => {
    setError("");
    if (!name.trim()) return;
    if (!NPM_NAME_REGEX.test(name.trim())) {
      setError("Invalid npm package name");
      return;
    }
    setAdding(true);
    try {
      const pkgPath = `./projects/${settings.project}/generated/package.json`;
      let pkg: Record<string, unknown> = { dependencies: {} };
      try {
        const existing = await readFile(pkgPath);
        pkg = JSON.parse(existing);
      } catch {
        // create new
      }
      const deps = (pkg.dependencies as Record<string, string>) || {};
      deps[name.trim()] = "latest";
      pkg.dependencies = deps;
      await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
      // Auto-install
      try {
        await bunInstall(`./projects/${settings.project}/generated`);
      } catch {
        // ignore install errors
      }
      setOpen(false);
      setName("");
      onAdded?.();
    } catch (e) {
      setError(`Failed: ${getErrorMessage(e)}`);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <PackagePlus size={12} />
            Add Library
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Library</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="lib-name">Package Name</Label>
            <Input
              id="lib-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="lodash"
              onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <Button className="w-full" onClick={handleAdd} disabled={adding}>
            {adding ? "Adding…" : "Add to package.json"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
