// Shared bottom code pane (per plan §2.5). Renders as two sibling
// `Allotment.Pane` elements in the mode's own vertical Allotment — a
// locked-size header row (tab buttons + collapse chevron) and a content pane
// whose visibility is driven by the `visible` prop. This is the
// collapse/expand pattern from coding-standards.md "For collapse/expand
// patterns with a visible header": the header and content panes must be
// direct siblings of the surrounding Allotment so the content pane can
// actually shrink to 0, not just hide its contents while the pane keeps its
// size. The mode file passes its tab strip (Editor/Links/Flow, CSS/Tokens/
// Design, or a single "Code" tab) as `tabButtons`, and its editor/preview
// component as `children`.

import { ChevronDown, ChevronUp } from "lucide-react";
import type { ReactNode } from "react";
import { PaneHeader } from "@/components/ui/pane-header";

export interface CreateCodePaneHeaderProps {
  visible: boolean;
  onToggle: () => void;
  tabButtons: ReactNode;
}

export function CreateCodePaneHeader({ visible, onToggle, tabButtons }: CreateCodePaneHeaderProps) {
  return (
    <PaneHeader onClick={onToggle}>
      {tabButtons}
      <div className="flex-1" />
      {visible ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
    </PaneHeader>
  );
}

export interface CreateCodePaneContentProps {
  children: ReactNode;
}

export function CreateCodePaneContent({ children }: CreateCodePaneContentProps) {
  return <div className="h-full overflow-hidden">{children}</div>;
}
