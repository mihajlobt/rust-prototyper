import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface RenameDialogProps {
  target: { path: string; name: string } | null;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function RenameDialog({ target, value, onChange, onConfirm, onClose }: RenameDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Rename &ldquo;{target?.name}&rdquo;</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="New name..." onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }} autoFocus />
          <Button className="w-full" onClick={onConfirm} disabled={!value.trim()}>Rename</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface NewFolderDialogProps {
  target: string | null;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function NewFolderDialog({ target, value, onChange, onConfirm, onClose }: NewFolderDialogProps) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New Folder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="Folder name..." onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }} autoFocus />
          <Button className="w-full" onClick={onConfirm} disabled={!value.trim()}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface NewFileDialogProps {
  open: boolean;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function NewFileDialog({ open, value, onChange, onConfirm, onClose }: NewFileDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>New File</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="filename.tsx" onKeyDown={(e) => { if (e.key === "Enter") onConfirm(); }} autoFocus />
          <Button className="w-full" onClick={onConfirm} disabled={!value.trim()}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
