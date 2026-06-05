// SelectionToChat — floating "Add to chat" button that appears above a
// non-empty selection in the plan editor.
//
// Clicking the button builds a MentionAsset of type "file" from the
// selected text and pushes it into the chat's mention list via
// `onAddMention`. The user can then send the message and the selection
// is included as a fenced code-block context to the agent.

import { useEffect, useState } from "react";
import { MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MentionAsset } from "@/types/chat";
import { type PlanEditorHandle, type SelectionInfo } from "./PlanEditor";

interface SelectionToChatProps {
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  selectionInfo: SelectionInfo | null;
  planName: string;
  planPath: string;
  onAddMention: (mention: MentionAsset) => void;
}

const BUTTON_OFFSET_PX = 36;

export function SelectionToChat({
  editorHandle,
  selectionInfo,
  planName,
  planPath,
  onAddMention,
}: SelectionToChatProps) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const view = editorHandle.current?.getView() ?? null;
    if (!view || !selectionInfo) {
      setPosition(null);
      return;
    }
    const update = () => {
      const coords = view.coordsAtPos(selectionInfo.from);
      if (!coords) {
        setPosition(null);
        return;
      }
      setPosition({ left: coords.left, top: coords.top - BUTTON_OFFSET_PX });
    };
    update();
    const scrollDom = view.scrollDOM;
    scrollDom.addEventListener("scroll", update);
    return () => scrollDom.removeEventListener("scroll", update);
  }, [editorHandle, selectionInfo]);

  if (!selectionInfo || !position) return null;

  const handleAdd = () => {
    const view = editorHandle.current?.getView();
    if (!view) return;
    const startLine = view.state.doc.lineAt(selectionInfo.from).number;
    const endLine = view.state.doc.lineAt(selectionInfo.to).number;
    const mention: MentionAsset = {
      id: `plan-selection-${planName}-${startLine}-${endLine}`,
      type: "file",
      name: `${planName} (L${startLine}–L${endLine})`,
      path: planPath,
      code: selectionInfo.text,
      description: `Selection from ${planName}, lines ${startLine}–${endLine}`,
    };
    onAddMention(mention);
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      onClick={handleAdd}
      style={{ position: "fixed", left: position.left, top: position.top, zIndex: 50 }}
      className="h-7 gap-1 px-2 text-[11px] shadow-md"
    >
      <MessageSquarePlus size={11} />
      Add to chat
    </Button>
  );
}
