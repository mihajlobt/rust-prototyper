// Port of src/panels/screens/ScreensCodeTabsHeader.tsx + the code-tab content
// switch from the bottom of ScreensPanel.tsx. Renders the Editor/Links/Flow
// tab header and the corresponding editor/preview component as two pieces —
// ScreensMode mounts each inside its own `Allotment.Pane` (locked-size header
// + visible-driven content), per the collapse/expand pattern in
// CreateCodePane.tsx.

import { Code2, MousePointerClick, Route } from "lucide-react";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { FlowsView } from "@/panels/FlowsView";
import { LinksEditor } from "@/panels/flows/LinksEditor";
import type { Hotspot } from "@/lib/navigation";
import { CreateCodePaneHeader, CreateCodePaneContent } from "../../CreateCodePane";

const tabClass = (active: boolean) =>
  [
    "px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1",
    active
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  ].join(" ");

interface ScreensCodePaneHeaderProps {
  createCodeOpen: boolean;
  createCodeTab: "editor" | "links" | "flow";
  onToggle: () => void;
  onSelectTab: (tab: "editor" | "links" | "flow") => void;
  isSelectingElement: boolean;
  onToggleSelectingElement: () => void;
}

export function ScreensCodePaneHeader({
  createCodeOpen,
  createCodeTab,
  onToggle,
  onSelectTab,
  isSelectingElement,
  onToggleSelectingElement,
}: ScreensCodePaneHeaderProps) {
  function selectTab(tab: "editor" | "links" | "flow") {
    onSelectTab(tab);
    if (!createCodeOpen) onToggle();
  }

  return (
    <CreateCodePaneHeader
      visible={createCodeOpen}
      onToggle={onToggle}
      tabButtons={
        <>
          <button className={tabClass(createCodeTab === "editor")} onClick={(e) => { e.stopPropagation(); selectTab("editor"); }}>
            <Code2 size={10} />Editor
          </button>
          <button className={tabClass(createCodeTab === "links")} onClick={(e) => { e.stopPropagation(); selectTab("links"); }}>
            <MousePointerClick size={10} />Links
          </button>
          <button className={tabClass(createCodeTab === "flow")} onClick={(e) => { e.stopPropagation(); selectTab("flow"); }}>
            <Route size={10} />Flow
          </button>
          <div className="flex-1" />
          {createCodeTab === "links" && (
            <button
              className={[
                "mr-1 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors",
                isSelectingElement ? "text-primary" : "text-muted-foreground hover:text-foreground",
              ].join(" ")}
              onClick={(e) => { e.stopPropagation(); onToggleSelectingElement(); }}
              title="Pick an element in the preview to link"
            >
              <MousePointerClick size={10} />
              {isSelectingElement ? "Selecting…" : "Pick element"}
            </button>
          )}
        </>
      }
    />
  );
}

interface ScreensCodePaneContentProps {
  createCodeTab: "editor" | "links" | "flow";
  code: string;
  onCodeChange: (value: string) => void;
  onCodeBlur: () => void;
  screenId: string | null;
  screenIds: string[];
  projectDir: string;
  hotspots: Hotspot[];
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  isSelectingElement: boolean;
  onToggleSelectingElement: () => void;
  newHotspotId: string | null;
  onNewHotspotHandled: () => void;
}

export function ScreensCodePaneContent({
  createCodeTab,
  code,
  onCodeChange,
  onCodeBlur,
  screenId,
  screenIds,
  projectDir,
  hotspots,
  onHotspotsChange,
  isSelectingElement,
  onToggleSelectingElement,
  newHotspotId,
  onNewHotspotHandled,
}: ScreensCodePaneContentProps) {
  return (
    <CreateCodePaneContent>
      {createCodeTab === "editor" ? (
        <CodeMirrorEditor value={code} onChange={onCodeChange} onBlur={onCodeBlur} mode="tsx" />
      ) : createCodeTab === "flow" ? (
        <FlowsView screenIds={screenIds} />
      ) : (
        <LinksEditor
          screenId={screenId ?? ""}
          projectDir={projectDir}
          hotspots={hotspots}
          screenIds={screenIds}
          onHotspotsChange={onHotspotsChange}
          isSelectingElement={isSelectingElement}
          newHotspotId={newHotspotId}
          onNewHotspotHandled={onNewHotspotHandled}
          onStartElementSelection={onToggleSelectingElement}
        />
      )}
    </CreateCodePaneContent>
  );
}
