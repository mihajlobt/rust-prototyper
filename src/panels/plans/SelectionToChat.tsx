import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MentionAsset } from "@/types/chat";
import { type PlanEditorHandle, type SelectionInfo } from "./PlanEditor";

interface SelectionToChatProps {
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  /** Ref (not state) — written by PlanEditor on every selection change without
   *  triggering a PlansPanel re-render during drag. Read here on mouseup. */
  selectionInfoRef: React.MutableRefObject<SelectionInfo | null>;
  planName: string;
  planPath: string;
  onAddMention: (mention: MentionAsset) => void;
}

interface PreviewSelectionState {
  text: string;
  top: number;
  left: number;
}

interface EditorButtonState {
  from: number;
  to: number;
  text: string;
  position: { top: number; left: number };
}

const BUTTON_OFFSET_PX = 36;

export function SelectionToChat({
  editorHandle,
  selectionInfoRef,
  planName,
  planPath,
  onAddMention,
}: SelectionToChatProps) {
  const [editorButtonState, setEditorButtonState] = useState<EditorButtonState | null>(null);
  const [previewSelection, setPreviewSelection] = useState<PreviewSelectionState | null>(null);

  // Mousedown: clear stale button state unless the user is clicking the button itself.
  // Using state (not ref) means no re-render here — state is only SET on mouseup.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element | null)?.closest?.("[data-stc-button]")) {
        setEditorButtonState(null);
        setPreviewSelection(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Mouseup: snapshot whichever selection is active and show the button.
  // This is the ONLY place button state is set — guarantees the button never
  // appears mid-drag (mousedown clears it, mouseup reveals it).
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-stc-button]")) return;

      // Preview selection takes priority — it is always the most recent action.
      // Editor selection (selectionInfoRef) can linger after focus leaves.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const editorDom = editorHandle.current?.getView()?.dom;
        if (!editorDom || !editorDom.contains(range.commonAncestorContainer)) {
          const text = sel.toString().trim();
          if (text) {
            const rect = range.getBoundingClientRect();
            setPreviewSelection({ text, top: rect.top - BUTTON_OFFSET_PX, left: rect.left });
            setEditorButtonState(null);
            return;
          }
        }
      }
      setPreviewSelection(null);

      // Editor selection — read from ref so we don't depend on PlansPanel state.
      const info = selectionInfoRef.current;
      const view = editorHandle.current?.getView();
      if (info && view && info.text.trim()) {
        const coords = view.coordsAtPos(info.from);
        if (coords) {
          setEditorButtonState({
            from: info.from,
            to: info.to,
            text: info.text,
            position: { top: coords.top - BUTTON_OFFSET_PX, left: coords.left },
          });
          return;
        }
      }
      setEditorButtonState(null);
    };
    document.addEventListener("mouseup", onUp);
    return () => document.removeEventListener("mouseup", onUp);
  }, [editorHandle, selectionInfoRef]);

  // Reposition the editor button when the editor scrolls.
  // Depends on `editorButtonState?.from` (a number) so re-subscribes only when
  // the user makes a new selection — not on every scroll-triggered position update.
  useEffect(() => {
    if (!editorButtonState) return;
    const view = editorHandle.current?.getView();
    if (!view) return;
    const { from } = editorButtonState;
    const update = () => {
      const coords = view.coordsAtPos(from);
      if (coords) {
        setEditorButtonState((prev) =>
          prev ? { ...prev, position: { top: coords.top - BUTTON_OFFSET_PX, left: coords.left } } : null,
        );
      }
    };
    const { scrollDOM } = view;
    scrollDOM.addEventListener("scroll", update);
    return () => scrollDOM.removeEventListener("scroll", update);
    // `editorButtonState` (full object) is intentionally excluded — scroll updates
    // only change `position`, not `from`, so re-subscribing on every scroll would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorHandle, editorButtonState?.from]);

  const handleAddEditor = () => {
    if (!editorButtonState) return;
    const view = editorHandle.current?.getView();
    if (!view) return;
    const startLine = view.state.doc.lineAt(editorButtonState.from).number;
    const endLine = view.state.doc.lineAt(editorButtonState.to).number;
    onAddMention({
      id: `plan-sel-${planName}-${startLine}-${endLine}`,
      type: "file",
      name: `${planName} (L${startLine}–L${endLine})`,
      path: planPath,
      code: editorButtonState.text,
      description: `Selection from ${planName}, lines ${startLine}–${endLine}`,
    });
    setEditorButtonState(null);
  };

  const handleAddPreview = () => {
    if (!previewSelection) return;
    const sanitized = previewSelection.text.replace(/\s+/g, " ").trim();
    const name = sanitized.length > 48 ? sanitized.slice(0, 48).trimEnd() + "…" : sanitized;
    onAddMention({
      id: `plan-preview-${planName}-${Date.now()}`,
      type: "file",
      name,
      path: planPath,
      code: previewSelection.text,
      description: `From ${planName}`,
    });
    setPreviewSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  if (previewSelection) {
    return (
      <Button
        data-stc-button
        type="button"
        size="sm"
        variant="default"
        onClick={handleAddPreview}
        style={{ position: "fixed", left: previewSelection.left, top: previewSelection.top, zIndex: 50 }}
        className="h-7 gap-1 px-2 text-[11px] shadow-md"
      >
        <MessageSquarePlus size={11} />
        Add to chat
      </Button>
    );
  }

  if (editorButtonState) {
    return (
      <Button
        data-stc-button
        type="button"
        size="sm"
        variant="default"
        onClick={handleAddEditor}
        style={{ position: "fixed", left: editorButtonState.position.left, top: editorButtonState.position.top, zIndex: 50 }}
        className="h-7 gap-1 px-2 text-[11px] shadow-md"
      >
        <MessageSquarePlus size={11} />
        Add to chat
      </Button>
    );
  }

  return null;
}
