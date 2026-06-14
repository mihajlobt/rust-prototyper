// Inlined from the deleted src/panels/wizard/WizardAnnotations.tsx (per plan
// §2.6). Renders the annotation list below the chat panel with send-to-AI
// functionality. Used only by WizardMode.

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { MapPin, RectangleHorizontal, Trash2, CheckCheck, Pencil, Send } from "lucide-react";
import type { Annotation } from "@/components/ui/AnnotationOverlay";

interface AnnotationTrayProps {
  annotations: Annotation[];
  onRemove: (id: string) => void;
  onResolve: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  onSendToAi: () => void;
  canSend: boolean;
}

export function AnnotationTray({
  annotations,
  onRemove,
  onResolve,
  onEdit,
  onSendToAi,
  canSend,
}: AnnotationTrayProps) {
  const open = annotations.filter((a) => !a.resolved);
  const resolved = annotations.filter((a) => a.resolved);

  if (annotations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <p className="text-xs text-muted-foreground">
          Enable annotation mode above, then click or drag on the preview to leave feedback for the AI.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1">
        <div className="space-y-1 p-2">
          {open.length > 0 && (
            <>
              <p className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Pending ({open.length})
              </p>
              {open.map((annotation, index) => (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  index={index + 1}
                  onRemove={onRemove}
                  onResolve={onResolve}
                  onEdit={onEdit}
                />
              ))}
            </>
          )}

          {resolved.length > 0 && (
            <>
              <p className="px-1 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/50 mt-2">
                Sent ({resolved.length})
              </p>
              {resolved.map((annotation, index) => (
                <AnnotationRow
                  key={annotation.id}
                  annotation={annotation}
                  index={open.length + index + 1}
                  onRemove={onRemove}
                  onResolve={onResolve}
                  onEdit={onEdit}
                  dimmed
                />
              ))}
            </>
          )}
        </div>
      </ScrollArea>

      {open.length > 0 && (
        <div className="border-t border-border p-2">
          <Button
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={onSendToAi}
            disabled={!canSend}
          >
            <Send className="h-3.5 w-3.5" />
            Send {open.length} annotation{open.length !== 1 ? "s" : ""} to AI
          </Button>
        </div>
      )}
    </div>
  );
}

interface AnnotationRowProps {
  annotation: Annotation;
  index: number;
  onRemove: (id: string) => void;
  onResolve: (id: string) => void;
  onEdit: (id: string, text: string) => void;
  dimmed?: boolean;
}

function AnnotationRow({ annotation, index, onRemove, onResolve, onEdit, dimmed }: AnnotationRowProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(annotation.text);

  useEffect(() => {
    if (!isEditing) setEditText(annotation.text);
  }, [annotation.text, isEditing]);

  const commitEdit = () => {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== annotation.text) onEdit(annotation.id, trimmed);
    else setEditText(annotation.text);
    setIsEditing(false);
  };

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-border/40 p-2 text-xs transition-opacity",
        dimmed ? "opacity-40" : "bg-muted/20",
      )}
    >
      <div className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground">
        {index}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-0.5">
          {annotation.type === "region"
            ? <RectangleHorizontal className="h-3 w-3" />
            : <MapPin className="h-3 w-3" />}
          {annotation.loc
            ? `<${annotation.elementTag ?? "element"}>${annotation.elementText ? ` "${annotation.elementText}"` : ""} — ${annotation.loc}`
            : annotation.selector
              ? `<${annotation.elementTag ?? "element"}>${annotation.elementText ? ` "${annotation.elementText}"` : ""}`
              : annotation.type === "region" && annotation.w !== undefined && annotation.h !== undefined
                ? `${annotation.x.toFixed(0)}%,${annotation.y.toFixed(0)}% → ${(annotation.x + annotation.w).toFixed(0)}%,${(annotation.y + annotation.h).toFixed(0)}%`
                : `${annotation.x.toFixed(0)}%, ${annotation.y.toFixed(0)}%`}
        </div>
        {isEditing ? (
          <Input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="h-6 text-xs"
            autoFocus
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitEdit();
              if (e.key === "Escape") { setEditText(annotation.text); setIsEditing(false); }
            }}
          />
        ) : (
          <p
            className="leading-snug text-foreground cursor-text"
            onClick={() => setIsEditing(true)}
          >
            {annotation.text}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-1">
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => setIsEditing(true)}
          title="Edit"
        >
          <Pencil className="h-3 w-3" />
        </Button>
        {!dimmed && (
          <>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => onRemove(annotation.id)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 p-0 text-muted-foreground hover:text-green-600"
              onClick={() => onResolve(annotation.id)}
              title="Mark as resolved"
            >
              <CheckCheck className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
