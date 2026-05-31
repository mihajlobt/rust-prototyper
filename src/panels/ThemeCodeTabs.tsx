import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

interface ThemeCodeTabsProps {
  css: string;
  designJson: string;
  designMd: string;
  activeTab: "css" | "tokens" | "guidelines";
  onChangeTab: (tab: "css" | "tokens" | "guidelines") => void;
  onChangeCss: (value: string) => void;
  onChangeJson: (value: string) => void;
  onChangeMd: (value: string) => void;
  onBlurCss: () => void;
  onBlurJson: () => void;
  onBlurMd: () => void;
  onReRender: () => void;
  hasDesignJson: boolean;
}

export function ThemeCodeTabs({
  css,
  designJson,
  designMd,
  activeTab,
  onChangeCss,
  onChangeJson,
  onChangeMd,
  onBlurCss,
  onBlurJson,
  onBlurMd,
  hasDesignJson,
}: ThemeCodeTabsProps) {
  const handleJsonChange = (value: string) => {
    onChangeJson(value);
  };

  return (
    <div className="h-full overflow-hidden">
      {activeTab === "css" && (
        <CodeMirrorEditor value={css} onChange={onChangeCss} onBlur={onBlurCss} mode="css" />
      )}
      {activeTab === "tokens" && (
        hasDesignJson ? (
          <CodeMirrorEditor value={designJson} onChange={handleJsonChange} onBlur={onBlurJson} mode="json" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design tokens yet. Switch to Design mode and generate a theme to create a structured spec.
          </div>
        )
      )}
      {activeTab === "guidelines" && (
        designMd ? (
          <CodeMirrorEditor value={designMd} onChange={onChangeMd} onBlur={onBlurMd} mode="markdown" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design document yet. Switch to Design mode and generate a theme to create DESIGN.md.
          </div>
        )
      )}
    </div>
  );
}