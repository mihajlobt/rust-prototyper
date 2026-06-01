import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  hotspotLabel,
  removeHotspot,
  updateHotspotTarget,
  updateHotspotName,
  syncGeneratedRouter,
  type Hotspot,
} from "@/lib/navigation";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";
import { cn } from "@/lib/utils";

interface LinksEditorProps {
  screenId: string;
  projectDir: string;
  hotspots: Hotspot[];
  screenIds: string[];
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  onStartElementSelection: () => void;
  isSelectingElement: boolean;
  newHotspotId?: string | null;
  onNewHotspotHandled?: () => void;
}

function LinkRow({
  hotspot,
  otherScreenIds,
  onTargetChange,
  onDelete,
  onRename,
  isNew,
}: {
  hotspot: Hotspot;
  otherScreenIds: string[];
  onTargetChange: (hotspotId: string, targetScreenId: string) => void;
  onDelete: (hotspotId: string) => void;
  onRename: (hotspotId: string, name: string | undefined) => void;
  isNew: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(hotspot.name ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(hotspot.name ?? ""); }, [hotspot.name]);

  // Select text when edit mode opens — useEffect fires after the Input mounts
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  function commitRename() {
    setEditing(false);
    const trimmed = draft.trim();
    // Empty draft → clear custom name, fall back to selector-derived label
    onRename(hotspot.id, trimmed || undefined);
  }

  const displayLabel = hotspot.selector ? hotspotLabel(hotspot) : "unlinked";

  return (
    <div
      className={cn(
        "group flex items-center gap-2 h-[25px] px-3 hover:bg-foreground/[0.04] transition-colors",
        isNew && "bg-foreground/[0.04]"
      )}
    >
      {/* Editable label — click to rename */}
      {editing ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") { setEditing(false); setDraft(hotspot.name ?? ""); }
          }}
          className="flex-1 min-w-0 h-4 px-0.5 py-0 text-[11px] font-mono border-0 border-b border-border bg-transparent rounded-none shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          autoFocus
          placeholder={displayLabel}
        />
      ) : (
        <button
          className={cn(
            "flex-1 min-w-0 text-left font-mono text-[11px] truncate transition-colors",
            hotspot.selector ? "text-foreground/75 hover:text-foreground" : "text-muted-foreground/35 italic",
            hotspot.name && "text-foreground/90"
          )}
          title={`${displayLabel} — click to rename`}
          onClick={() => setEditing(true)}
        >
          {displayLabel}
        </button>
      )}

      {/* Connector */}
      <span className="shrink-0 text-[10px] text-muted-foreground/25 select-none">→</span>

      {/* Target screen — fixed width keeps the chevron anchored, not at pane edge */}
      <Select
        value={hotspot.targetScreenId || undefined}
        onValueChange={(v) => onTargetChange(hotspot.id, v)}
      >
        <SelectTrigger
          className={cn(
            "h-5 w-[108px] shrink-0 border-0 bg-transparent px-1 shadow-none",
            "text-[11px] focus:ring-0 focus:ring-offset-0",
            hotspot.targetScreenId ? "text-muted-foreground" : "text-muted-foreground/35"
          )}
        >
          <SelectValue placeholder="pick screen" />
        </SelectTrigger>
        <SelectContent>
          {otherScreenIds.map((id) => (
            <SelectItem key={id} value={id} className="text-xs">
              {id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Delete — reveals on hover */}
      <button
        className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground/40 hover:text-destructive"
        onClick={() => onDelete(hotspot.id)}
        title="Remove"
      >
        <Trash2 size={11} />
      </button>
    </div>
  );
}

export function LinksEditor({
  screenId: currentScreenId,
  projectDir,
  hotspots,
  screenIds,
  onHotspotsChange,
  onStartElementSelection,
  isSelectingElement,
  newHotspotId,
  onNewHotspotHandled,
}: LinksEditorProps) {
  const otherScreenIds = screenIds.filter((id) => id !== currentScreenId);

  async function handleTargetChange(hotspotId: string, targetScreenId: string) {
    try {
      await updateHotspotTarget(projectDir, hotspotId, targetScreenId);
      onHotspotsChange(hotspots.map((h) => (h.id === hotspotId ? { ...h, targetScreenId } : h)));
      await syncGeneratedRouter(projectDir);
      window.dispatchEvent(new Event("navigation-changed"));
    } catch (e) {
      notify.error("Failed to update target", getErrorMessage(e));
    }
    onNewHotspotHandled?.();
  }

  async function handleRename(hotspotId: string, name: string | undefined) {
    try {
      await updateHotspotName(projectDir, hotspotId, name);
      onHotspotsChange(hotspots.map((h) => (h.id === hotspotId ? { ...h, name } : h)));
      window.dispatchEvent(new Event("navigation-changed"));
    } catch (e) {
      notify.error("Failed to rename link", getErrorMessage(e));
    }
  }

  async function handleDelete(hotspotId: string) {
    try {
      await removeHotspot(projectDir, hotspotId);
      onHotspotsChange(hotspots.filter((h) => h.id !== hotspotId));
      await syncGeneratedRouter(projectDir);
      window.dispatchEvent(new Event("navigation-changed"));
    } catch (e) {
      notify.error("Failed to delete link", getErrorMessage(e));
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Selecting mode indicator */}
      {isSelectingElement && (
        <div className="shrink-0 flex items-center gap-2 px-3 h-7 bg-primary/[0.04] border-t border-t-primary/30 border-b border-b-border/40">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary/80" />
          </span>
          <span className="flex-1 text-[11px] text-muted-foreground">Click an element in the preview</span>
          <button
            onClick={onStartElementSelection}
            className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
            title="Cancel"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {hotspots.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 px-6 text-center">
            <p className="text-[11px] text-muted-foreground/40 leading-relaxed">
              No navigation links.<br />
              Pick an element to get started.
            </p>
            <button
              onClick={onStartElementSelection}
              className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-1"
            >
              <Plus size={10} />
              Pick element
            </button>
          </div>
        ) : (
          <div className="py-0.5">
            {hotspots.map((h) => (
              <LinkRow
                key={h.id}
                hotspot={h}
                otherScreenIds={otherScreenIds}
                onTargetChange={handleTargetChange}
                onDelete={handleDelete}
                onRename={handleRename}
                isNew={h.id === newHotspotId}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
