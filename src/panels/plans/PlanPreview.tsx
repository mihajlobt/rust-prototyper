// PlanPreview — the live preview pane for the Plans section.
//
// Built directly on `react-markdown` rather than reusing the `Markdown` UI
// component, because the plans preview needs:
//   - `remark-directive` for `:::timeline` / `:::details` / etc.
//   - `remark-gfm` (already in the global `Markdown`, but we set it ourselves)
//   - A custom `pre`/`code` chain that:
//       - keeps shiki highlighting for block code (titled fences), AND
//       - transforms inline `code` content for kbd (`[[Cmd]]`), mentions
//         (`@kind/name`), and hashtags (`#tag`).
//   - Task checkboxes that toggle the source string via a callback.
//   - Heading anchor links fed into the outline rail (scroll-spy in phase 3).
//   - Callout blockquotes (`> [!NOTE]`, `> [!WARNING]`, etc.) with a custom
//     icon + hue per variant.
//
// Body text comes from `parseFrontmatter()` — frontmatter is rendered
// separately by `<FrontmatterHeader>`.

import { useMemo } from "react";
import React from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkDirective from "remark-directive";
import {
  Info,
  Lightbulb,
  AlertTriangle,
  AlertOctagon,
  CheckCircle2,
  Scale,
  HelpCircle,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CodeBlock, CodeBlockCode, CodeBlockHeader } from "@/components/ui/code-block";
import { remarkPlanDirectives } from "@/lib/markdown/directives";
import { KbdChip, MentionChip, TagChip } from "./chips";

interface PlanPreviewProps {
  body: string;
  /** Called when a task checkbox in the preview is toggled. Line index is
   *  relative to the body (NOT the full source), 0-indexed. */
  onTaskToggle?: (line: number) => void;
}

const CALLOUT_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DECISION|QUESTION|GOAL)\]/i;

export function PlanPreview({ body, onTaskToggle }: PlanPreviewProps) {
  const components = useMemo(() => buildComponents(onTaskToggle), [onTaskToggle]);
  return (
    <div className="md-render prose prose-sm dark:prose-invert max-w-none p-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkDirective, remarkBreaks, remarkPlanDirectives]}
        components={components}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

// ─── Custom component overrides ──────────────────────────────────────────────

function buildComponents(onTaskToggle?: (line: number) => void): Partial<Components> {
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
      // Block code (with a language) is handled by `pre` above. When we reach
      // this handler with className set, it's block code without a `pre`
      // wrapper (defensive). When className is empty, it's inline code.
      if (className && /language-/.test(className)) {
        return <code className={className}>{children}</code>;
      }
      return <InlineCode text={text} />;
    },
    blockquote: function BlockquoteComponent({ children }) {
      // The first child of a callout is a paragraph containing the variant
      // marker text like "[!NOTE] Body…". We peek into the rendered children
      // to extract the variant.
      const variant = extractCalloutVariant(children);
      if (variant) {
        return <Callout variant={variant}>{children}</Callout>;
      }
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
    input: function CheckboxComponent({ checked, ...rest }) {
      // Checkboxes come from GFM task lists. We render them disabled — the
      // preview's task toggling is wired via a click on the parent <li>, not
      // the checkbox itself (see <li> override below).
      return (
        <input
          type="checkbox"
          checked={!!checked}
          readOnly
          className="mr-1.5 align-middle accent-primary cursor-pointer"
          {...rest}
        />
      );
    },
    li: function ListItemComponent({ children, ...rest }) {
      // Wrap task items so clicking anywhere on the line toggles the source.
      if (!onTaskToggle) {
        return <li {...rest}>{children}</li>;
      }
      return (
        <li
          {...rest}
          onClick={(e) => {
            // Only respond to clicks directly on the line (not on links etc.)
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
  };
}

// ─── Inline transforms ───────────────────────────────────────────────────────

function InlineCode({ text }: { text: string }) {
  // `[[Cmd]]` → kbd chip
  const kbdMatch = /^\[\[([^\]]+)\]\]$/.exec(text);
  if (kbdMatch) return <KbdChip label={kbdMatch[1]} />;

  // `@kind/name` → mention chip
  const mentionMatch = /^@([a-z]+)\/([\w-]+)$/.exec(text);
  if (mentionMatch) return <MentionChip kind={mentionMatch[1]} name={mentionMatch[2]} />;

  // `#tag` → tag chip
  const tagMatch = /^#([\w-]+)$/.exec(text);
  if (tagMatch) return <TagChip tag={tagMatch[1]} />;

  return (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[12px]">
      {text}
    </code>
  );
}

// ─── Headings with anchor links ──────────────────────────────────────────────

function HeadingTag({ level, children, ...rest }: { level: number; children?: React.ReactNode } & Record<string, unknown>) {
  // Reuse react-markdown's auto-generated id (it slugifies children if a
  // custom `id` is not passed via rehype). We add an `#` link that appears
  // on hover.
  const id = (rest as { id?: string }).id;
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
  switch (level) {
    case 1: return <h1 id={id} className={className}>{inner}</h1>;
    case 2: return <h2 id={id} className={className}>{inner}</h2>;
    case 3: return <h3 id={id} className={className}>{inner}</h3>;
    case 4: return <h4 id={id} className={className}>{inner}</h4>;
    case 5: return <h5 id={id} className={className}>{inner}</h5>;
    case 6: return <h6 id={id} className={className}>{inner}</h6>;
  }
}

// ─── Callouts ────────────────────────────────────────────────────────────────

type CalloutVariant = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION" | "DECISION" | "QUESTION" | "GOAL";

const CALLOUT_META: Record<CalloutVariant, { icon: React.ComponentType<{ size?: number }>; className: string; label: string }> = {
  NOTE:      { icon: Info,          className: "border-blue-500/30 bg-blue-500/5 text-blue-100",  label: "Note" },
  TIP:       { icon: Lightbulb,     className: "border-teal-500/30 bg-teal-500/5 text-teal-100",  label: "Tip" },
  IMPORTANT: { icon: CheckCircle2,  className: "border-violet-500/30 bg-violet-500/5 text-violet-100", label: "Important" },
  WARNING:   { icon: AlertTriangle, className: "border-amber-500/30 bg-amber-500/5 text-amber-100", label: "Warning" },
  CAUTION:   { icon: AlertOctagon,  className: "border-red-500/30 bg-red-500/5 text-red-100",  label: "Caution" },
  DECISION:  { icon: Scale,         className: "border-violet-500/30 bg-violet-500/5 text-violet-100", label: "Decision" },
  QUESTION:  { icon: HelpCircle,    className: "border-rose-500/30 bg-rose-500/5 text-rose-100",  label: "Question" },
  GOAL:      { icon: Target,        className: "border-teal-500/30 bg-teal-500/5 text-teal-100",  label: "Goal" },
};

function extractCalloutVariant(children: React.ReactNode): CalloutVariant | null {
  // react-markdown passes the blockquote's children — typically a <p> whose
  // text content starts with `[!TYPE]`. We do a shallow string match.
  let text = "";
  collectText(children, (s) => (text += s));
  const m = CALLOUT_RE.exec(text);
  if (!m) return null;
  return m[1].toUpperCase() as CalloutVariant;
}

function collectText(node: React.ReactNode, sink: (s: string) => void): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    sink(String(node));
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((c) => collectText(c, sink));
    return;
  }
  if (React.isValidElement(node)) {
    collectText((node.props as { children?: React.ReactNode }).children, sink);
  }
}

function Callout({ variant, children }: { variant: CalloutVariant; children: React.ReactNode }) {
  const meta = CALLOUT_META[variant];
  const Icon = meta.icon;
  // Strip the leading `[!TYPE]` marker from the first paragraph so the body
  // reads naturally.
  const stripped = stripCalloutMarker(children);
  return (
    <aside
      className={cn(
        "my-3 rounded-md border px-3 py-2.5 not-prose",
        meta.className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider opacity-90 mb-1">
        <Icon size={11} />
        {meta.label}
      </div>
      <div className="text-[13px] leading-relaxed [&>p]:m-0">{stripped}</div>
    </aside>
  );
}

function stripCalloutMarker(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (!React.isValidElement(child)) return child;
    const c = child as React.ReactElement<{ children?: React.ReactNode }>;
    if (typeof c.props.children === "string") {
      const stripped = c.props.children.replace(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|DECISION|QUESTION|GOAL)\]\s*/i, "");
      return React.cloneElement(c, { children: stripped });
    }
    return React.cloneElement(c, { children: stripCalloutMarker(c.props.children) });
  });
}

// ─── Task toggle helper ─────────────────────────────────────────────────────

// `rest.node` is the hast element passed by react-markdown. We use the
// `sourceLine` field if present (it is, when `remark-rehype` is wired up),
// otherwise fall back to walking for the line text.
function getLineIndex(node: unknown): number {
  if (node && typeof node === "object" && "position" in node) {
    const position = (node as { position?: { start?: { line?: number } } }).position;
    if (position?.start?.line) return position.start.line - 1;
  }
  return 0;
}
