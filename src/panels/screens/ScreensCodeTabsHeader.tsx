import { ChevronDown, ChevronUp, Code2, MousePointerClick, Route } from "lucide-react";
import { PaneHeader } from "@/components/ui/pane-header";
import type { RefObject } from "react";
import type { ProjectSettings } from "@/stores/projectSettingsStore";

type SetProjectSettings = (patch: Partial<ProjectSettings>) => void;

interface ScreensCodeTabsHeaderProps {
  screensCodeOpen: boolean;
  screensCodeTab: string;
  isSelectingElement: boolean;
  setIsSelectingElement: (v: boolean) => void;
  previewIframeRef: RefObject<HTMLIFrameElement | null>;
  setProjectSettings: SetProjectSettings;
}

export function ScreensCodeTabsHeader({
  screensCodeOpen,
  screensCodeTab,
  isSelectingElement,
  setIsSelectingElement,
  previewIframeRef,
  setProjectSettings,
}: ScreensCodeTabsHeaderProps) {
  // Toggling selection also toggles the iframe's link-mode overlay via postMessage.
  // Kept inline (not memoized) — only fires on user click, not on render.
  function toggleSelection() {
    if (isSelectingElement) {
      setIsSelectingElement(false);
      previewIframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*");
    } else {
      setIsSelectingElement(true);
      previewIframeRef.current?.contentWindow?.postMessage({ type: "enable-link-mode" }, "*");
    }
  }

  function selectTab(tab: "editor" | "links" | "flow") {
    setProjectSettings({ screensCodeTab: tab });
    if (!screensCodeOpen) setProjectSettings({ screensCodeOpen: true });
  }

  const tabClass = (active: boolean) =>
    [
      "px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1",
      active
        ? "bg-secondary text-secondary-foreground"
        : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
    ].join(" ");

  return (
    <PaneHeader onClick={() => setProjectSettings({ screensCodeOpen: !screensCodeOpen })}>
      <button
        className={tabClass(screensCodeTab === "editor")}
        onClick={(e) => {
          e.stopPropagation();
          selectTab("editor");
        }}
      >
        <Code2 size={10} />Editor
      </button>
      <button
        className={tabClass(screensCodeTab === "links")}
        onClick={(e) => {
          e.stopPropagation();
          selectTab("links");
        }}
      >
        <MousePointerClick size={10} />Links
      </button>
      <button
        className={tabClass(screensCodeTab === "flow")}
        onClick={(e) => {
          e.stopPropagation();
          selectTab("flow");
        }}
      >
        <Route size={10} />Flow
      </button>
      <div className="flex-1" />
      {screensCodeTab === "links" && (
        <button
          className={[
            "mr-1 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors",
            isSelectingElement
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          ].join(" ")}
          onClick={(e) => {
            e.stopPropagation();
            toggleSelection();
          }}
          title="Pick an element in the preview to link"
        >
          <MousePointerClick size={10} />
          {isSelectingElement ? "Selecting…" : "Pick element"}
        </button>
      )}
      {screensCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
    </PaneHeader>
  );
}
