// PlanPreview — the live preview pane for the Plans section.
//
// Built directly on `react-markdown` rather than reusing the global
// `Markdown` component because plans need:
//   - `remark-github-alerts` for `> [!NOTE]` / `> [!WARNING]` etc. alerts.
//   - A custom `pre`/`code` chain that:
//       - shiki highlighting for block code (CodeBlock chain),
//       - color swatches for inline color literals (parity with global Markdown),
//       - chip rendering for mentions/kbd/tags.
//   - Task checkboxes that toggle the source string via a callback.
//   - Heading anchor links + outline scroll-spy via the inline DesignToc
//     toggle (a top-right button reveals a 2-pane Allotment with the TOC).
//   - Stacked `<details>` blocks rendered as tabs in Report mode (rehype-group-details).

import { useMemo, useState } from "react";
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkGithubAlerts from "remark-github-alerts";
import rehypeRaw from "rehype-raw";
import rehypeGroupDetails from "./rehype-group-details";
import { Allotment } from "allotment";
import { Eye, EyeOff, List } from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CodeBlock, CodeBlockCode, CodeBlockHeader } from "@/components/ui/code-block";
import { DesignToc, slugify } from "@/components/ui/design-toc";
import { KbdChip, MentionChip, TagChip } from "./chips";

interface PlanPreviewProps {
  body: string;
  /** Called when a task checkbox in the preview is toggled. Line index is
   *  relative to the body (NOT the full source), 0-indexed. */
  onTaskToggle?: (line: number) => void;
  /** Forces the richer "Report" skin on, bypassing the in-component Eye toggle.
   *  Used by Research content-type, which always wants the rich render. */
  reportMode?: boolean;
}


export function PlanPreview({ body, onTaskToggle, reportMode: forcedReportMode }: PlanPreviewProps) {
  const [showOutline, setShowOutline] = useState(false);
  const [reportModeToggle, setReportModeToggle] = useState(false);
  const reportMode = forcedReportMode ?? reportModeToggle;
  const components = useMemo(() => buildComponents(onTaskToggle, reportMode), [onTaskToggle, reportMode]);

  return (
    <div className="relative h-full min-h-0">
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        {forcedReportMode === undefined && (
          <Toggle
            pressed={reportModeToggle}
            onPressedChange={setReportModeToggle}
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px] bg-background/80 backdrop-blur shadow-sm"
          >
            {reportModeToggle ? <Eye size={11} /> : <EyeOff size={11} />} Report
          </Toggle>
        )}
        <Toggle
          pressed={showOutline}
          onPressedChange={setShowOutline}
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[10px] bg-background/80 backdrop-blur shadow-sm"
        >
          <List size={11} /> Outline
        </Toggle>
      </div>
      <Allotment onVisibleChange={(index, visible) => { if (index === 0) setShowOutline(visible); }}>
        <Allotment.Pane visible={showOutline} minSize={120} preferredSize={200} snap>
          <div className="h-full overflow-auto border-r border-border bg-card/30 p-3">
            <DesignToc markdown={body} />
          </div>
        </Allotment.Pane>
        <Allotment.Pane minSize={200}>
          <div className="h-full overflow-auto">
            <div className={reportMode ? "mx-auto max-w-[920px] p-4 md-render--report" : "mx-auto max-w-[760px] p-4"}>
              <div className="md-render prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkGithubAlerts, remarkBreaks]}
                  remarkRehypeOptions={{allowDangerousHtml: true}}
                  rehypePlugins={[rehypeRaw, rehypeGroupDetails]}
                  components={components}
                >
                  {body}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}

// ─── Custom component overrides ──────────────────────────────────────────────

function buildComponents(onTaskToggle?: (line: number) => void, reportMode = false): Partial<Components> {
  return {
    pre: function PreComponent({ children }) {
      // The same shiki handling as the global Markdown component.
      const child = children as { props?: { className?: string; children?: string } } | typeof children;
      if (!child || typeof child !== "object" || !("props" in child)) {
        return <pre>{children}</pre>;
      }
      const codeProps = (child as { props: { className?: string; children?: string } }).props;
      const language = /language-(\w+)/.exec(codeProps.className ?? "")?.[1] ?? "text";
      const code = String(codeProps.children ?? "").replace(/\n$/, "");
      return (
        <CodeBlock>
          <CodeBlockHeader language={language} code={code} />
          <CodeBlockCode code={code} language={language} />
        </CodeBlock>
      );
    },
    code: function CodeComponent({ children, className }) {
      const text = String(children ?? "");
      if (className && /language-/.test(className)) {
        return <code className={className}>{children}</code>;
      }
      return <InlineCode text={text} />;
    },
    blockquote: function BlockquoteComponent({ children }) {
      return (
        <blockquote className="border-l-2 border-border pl-3 italic text-muted-foreground my-3">
          {children}
        </blockquote>
      );
    },
    a: function AnchorComponent({ children, href }) {
      return (
        <a
          href={href}
          className="text-primary underline underline-offset-2 hover:text-primary/80"
          target={href?.startsWith("http") ? "_blank" : undefined}
          rel={href?.startsWith("http") ? "noopener noreferrer" : undefined}
        >
          {children}
        </a>
      );
    },
    input: function CheckboxComponent({ checked }) {
      return (
        <input
          type="checkbox"
          checked={!!checked}
          onChange={() => {}}
          className="mr-1.5 align-middle accent-primary pointer-events-none"
        />
      );
    },
    li: function ListItemComponent({ children, ...rest }) {
      if (!onTaskToggle) {
        return <li {...rest}>{children}</li>;
      }
      return (
        <li
          {...rest}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("a, code, pre")) return;
            onTaskToggle(getLineIndex(rest.node));
          }}
        >
          {children}
        </li>
      );
    },
    h1: (props) => <HeadingTag level={1} {...props} />,
    h2: (props) => <HeadingTag level={2} {...props} />,
    h3: (props) => <HeadingTag level={3} {...props} />,
    h4: (props) => <HeadingTag level={4} {...props} />,
    h5: (props) => <HeadingTag level={5} {...props} />,
    h6: (props) => <HeadingTag level={6} {...props} />,
    details: function DetailsComponent({ children, ...props }) {
      const arr = React.Children.toArray(children);
      const summary = arr.find((c) => React.isValidElement(c) && (c as React.ReactElement).type === "summary");
      const body = arr.filter((c) => !(React.isValidElement(c) && (c as React.ReactElement).type === "summary"));
      return (
        <details {...(props as React.HTMLAttributes<HTMLDetailsElement>)}>
          {summary}
          {body.length > 0 && (
            <div className="px-3.5 py-3 [&>*:last-child]:mb-0">{body}</div>
          )}
        </details>
      );
    },
    div: function DivComponent({ className, children, ...rest }) {
      const classList = typeof className === "string" ? className.split(" ") : [];
      if (!classList.includes("md-tabgroup")) {
        return <div className={className} {...rest}>{children}</div>;
      }
      if (!reportMode) {
        return <>{children}</>;
      }
      return <TabGroup>{children}</TabGroup>;
    },
  };
}

// ─── Tab group ─────────────────────────────────────────────────────────────────

function isDetailsEl(child: React.ReactNode): child is React.ReactElement {
  return React.isValidElement(child) && typeof child.type === "string" && child.type === "details";
}

function isSummaryEl(child: React.ReactNode): child is React.ReactElement {
  return React.isValidElement(child) && typeof child.type === "string" && child.type === "summary";
}

function TabGroup({ children }: { children?: React.ReactNode }) {
  const items = React.Children.toArray(children)
    .filter(isDetailsEl)
    .map((detailsEl, index) => {
      const detailsChildren = React.Children.toArray(
        (detailsEl.props as { children?: React.ReactNode }).children
      );
      const summary = detailsChildren.find(isSummaryEl);
      const body = detailsChildren.filter((c) => c !== summary);
      let label = "";
      collectText(summary, (s) => (label += s));
      return { id: `tab-${index}`, label: label || `Tab ${index + 1}`, body };
    });

  if (items.length === 0) return null;

  return (
    <Tabs defaultValue={items[0].id} className="not-prose my-3">
      <TabsList>
        {items.map((item) => (
          <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.id} value={item.id} className="prose prose-sm dark:prose-invert max-w-none">
          {item.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}

// ─── Inline transforms ───────────────────────────────────────────────────────

const NAMED_COLORS = new Set([
  "red","blue","green","yellow","orange","purple","pink","brown","black","white",
  "gray","grey","cyan","magenta","lime","navy","teal","maroon","olive","silver",
  "gold","coral","violet","indigo","crimson","turquoise","salmon","plum","khaki",
  "tan","azure","ivory","beige","wheat","lavender","mint","skyblue","tomato",
  "orangered","hotpink","darkred","darkblue","darkgreen","darkorange",
]);
const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b)|(oklch\([^)]+\))|(rgba?\([^)]+\))|(hsla?\([^)]+\))/;

function parseColorLiteral(text: string): string | null {
  const trimmed = text.trim();
  const match = trimmed.match(COLOR_RE);
  if (match) return match[0];
  if (NAMED_COLORS.has(trimmed.toLowerCase())) return trimmed.toLowerCase();
  return null;
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-3 rounded border border-border align-middle mx-0.5 shrink-0"
      style={{ backgroundColor: color }}
      title={color}
    />
  );
}

function InlineCode({ text }: { text: string }) {
  const color = parseColorLiteral(text);
  const kbdMatch = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (kbdMatch) return <KbdChip label={kbdMatch[1]} />;

  const mentionMatch = /^@([a-z]+)\/([\w-]+)$/.exec(text);
  if (mentionMatch) return <MentionChip kind={mentionMatch[1]} name={mentionMatch[2]} />;

  const tagMatch = /^#([\w-]+)$/.exec(text);
  if (tagMatch) return <TagChip tag={tagMatch[1]} />;

  if (color) {
    return (
      <code className="rounded-sm bg-muted px-1 font-mono text-[12px] inline-flex items-center gap-0.5">
        <ColorSwatch color={color} />
        {text}
      </code>
    );
  }

  return (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[12px]">
      {text}
    </code>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function collectText(node: React.ReactNode, sink: (s: string) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") { sink(String(node)); return; }
  if (Array.isArray(node)) { node.forEach((c) => collectText(c, sink)); return; }
  if (React.isValidElement(node)) collectText((node.props as { children?: React.ReactNode }).children, sink);
}

// ─── Headings with anchor links ──────────────────────────────────────────────

function HeadingTag({ level, children }: { level: number; children?: React.ReactNode } & Record<string, unknown>) {
  let headingText = "";
  collectText(children, (s) => (headingText += s));
  const id = headingText ? slugify(headingText) : undefined;
  const inner = (
    <>
      {children}
      {id ? (
        <a
          href={`#${id}`}
          aria-label="Link to section"
          className="ml-1.5 opacity-0 hover:opacity-100 text-muted-foreground no-underline"
        >
          #
        </a>
      ) : null}
    </>
  );
  const className = "scroll-mt-12";
  const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
  return <Tag id={id} className={className}>{inner}</Tag>;
}

// ─── Task toggle helper ─────────────────────────────────────────────────────

function getLineIndex(node: unknown): number {
  if (node && typeof node === "object" && "position" in node) {
    const position = (node as { position?: { start?: { line?: number } } }).position;
    if (position?.start?.line) return position.start.line - 1;
  }
  return 0;
}
