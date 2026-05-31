import { Eye, Pencil } from "lucide-react";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { Markdown } from "@/components/ui/markdown";

interface ThemeCodeTabsProps {
  css: string;
  designJson: string;
  designMd: string;
  activeTab: "css" | "tokens" | "guidelines";
  onChangeCss: (value: string) => void;
  onChangeJson: (value: string) => void;
  onChangeMd: (value: string) => void;
  hasDesignJson: boolean;
  designPreviewing: boolean;
  onToggleDesignPreview: () => void;
}

export function ThemeCodeTabs({
  css,
  designJson,
  designMd,
  activeTab,
  onChangeCss,
  onChangeJson,
  onChangeMd,
  hasDesignJson,
  designPreviewing,
  onToggleDesignPreview,
}: ThemeCodeTabsProps) {
  return (
    <div className="h-full overflow-hidden">
      {activeTab === "css" && (
        <CodeMirrorEditor value={css} onChange={onChangeCss} mode="css" />
      )}
      {activeTab === "tokens" && (
        hasDesignJson ? (
          <CodeMirrorEditor value={designJson} onChange={onChangeJson} mode="json" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design tokens yet. Switch to Design mode and generate a theme to create a structured spec.
          </div>
        )
      )}
      {activeTab === "guidelines" && (
        designMd ? (
          <div className="h-full relative">
            <button
              className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 text-[10px]
                font-medium rounded bg-background/80 backdrop-blur border border-border shadow-sm
                text-muted-foreground hover:text-foreground transition-colors"
              onClick={onToggleDesignPreview}
            >
              {designPreviewing ? (
                <><Pencil size={11} /> Edit</>
              ) : (
                <><Eye size={11} /> Preview</>
              )}
            </button>
            {designPreviewing ? (
              <div className="h-full overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none text-sm">
                <Markdown>{designMd}</Markdown>
              </div>
            ) : (
              <CodeMirrorEditor value={designMd} onChange={onChangeMd} mode="markdown" />
            )}
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design document yet. Switch to Design mode and generate a theme to create DESIGN.md.
          </div>
        )
      )}
    </div>
  );
}