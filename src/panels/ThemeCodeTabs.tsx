import { Children, isValidElement, useMemo, useState } from "react";
import { Eye, Pencil, List } from "lucide-react";
import { Allotment } from "allotment";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { Markdown } from "@/components/ui/markdown";
import { DesignToc, slugify } from "@/components/ui/design-toc";
import type { Components } from "react-markdown";

interface ThemeCodeTabsProps {
  css: string;
  designJson: string;
  designMd: string;
  activeTab: "css" | "tokens" | "guidelines";
  onChangeCss: (value: string) => void;
  onChangeJson: (value: string) => void;
  onChangeMd: (value: string) => void;
  /** Persist the edited file to disk when its editor loses focus. */
  onBlurCss?: () => void;
  onBlurJson?: () => void;
  onBlurMd?: () => void;
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
  onBlurCss,
  onBlurJson,
  onBlurMd,
  hasDesignJson,
  designPreviewing,
  onToggleDesignPreview,
}: ThemeCodeTabsProps) {
  const headingComponents = useMemo((): Partial<Components> => ({
    h1: ({ children, ...props }) => {
      const text = extractTextContent(children);
      return <h1 id={slugify(text)} {...props}>{children}</h1>;
    },
    h2: ({ children, ...props }) => {
      const text = extractTextContent(children);
      return <h2 id={slugify(text)} {...props}>{children}</h2>;
    },
    h3: ({ children, ...props }) => {
      const text = extractTextContent(children);
      return <h3 id={slugify(text)} {...props}>{children}</h3>;
    },
  }), []);

  const [showOutline, setShowOutline] = useState(false);

  return (
    <div className="h-full overflow-hidden">
      {activeTab === "css" && (
        <CodeMirrorEditor value={css} onChange={onChangeCss} onBlur={onBlurCss} mode="css" />
      )}
      {activeTab === "tokens" && (
        hasDesignJson ? (
          <CodeMirrorEditor value={designJson} onChange={onChangeJson} onBlur={onBlurJson} mode="json" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design tokens yet. Switch to Design mode and generate a theme to create a structured spec.
          </div>
        )
      )}
      {activeTab === "guidelines" && (
        designMd ? (
          designPreviewing ? (
            <div className="h-full relative">
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1
                rounded border border-border shadow-sm overflow-hidden
                bg-background/80 backdrop-blur">
                <button
                  className={[
                    "flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
                    showOutline
                      ? "bg-secondary text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                  ].join(" ")}
                  onClick={() => setShowOutline(!showOutline)}
                >
                  <List size={11} /> Outline
                </button>
                <div className="w-px h-4 bg-border" />
                <button
                  className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium
                    text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                  onClick={onToggleDesignPreview}
                >
                  <Pencil size={11} /> Edit
                </button>
              </div>
              <div className="h-full min-h-0">
                <Allotment onVisibleChange={(index, visible) => {
                  if (index === 0) setShowOutline(visible);
                }}>
                  <Allotment.Pane visible={showOutline} minSize={120} preferredSize={180} snap>
                    <DesignToc markdown={designMd} />
                  </Allotment.Pane>
                  <Allotment.Pane minSize={200}>
                    <div className="h-full overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none text-sm">
                      <Markdown components={headingComponents}>{designMd}</Markdown>
                    </div>
                  </Allotment.Pane>
                </Allotment>
              </div>
            </div>
          ) : (
            <div className="h-full relative">
              <button
                className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 text-[10px]
                  font-medium rounded bg-background/80 backdrop-blur border border-border shadow-sm
                  text-muted-foreground hover:text-foreground transition-colors"
                onClick={onToggleDesignPreview}
              >
                <Eye size={11} /> Preview
              </button>
              <CodeMirrorEditor value={designMd} onChange={onChangeMd} onBlur={onBlurMd} mode="markdown" />
            </div>
          )
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
            No design document yet. Switch to Design mode and generate a theme to create DESIGN.md.
          </div>
        )
      )}
    </div>
  );
}

// Recurse through inline markup (e.g. `## **Bold** title`) so the derived heading id
// matches design-toc's slug, which is computed from the raw markdown heading text.
function extractTextContent(children: React.ReactNode): string {
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(extractTextContent).join("");
  if (isValidElement<{ children?: React.ReactNode }>(children)) {
    return Children.toArray(children.props.children).map(extractTextContent).join("");
  }
  return "";
}
