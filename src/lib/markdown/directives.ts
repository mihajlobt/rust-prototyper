// Remark plugin: convert remark-directive nodes into hast elements with stable
// `data-directive` attributes that the PlanPreview component renders.
//
// remark-directive exposes three node types:
//   - containerDirective (`:::name[label]{attrs}\nbody\n:::`)
//   - leafDirective       (`::name[label]{attrs}`)
//   - textDirective       (`:name[label]{attrs}`)
//
// We support container directives for layout blocks (timeline, details,
// columns, board, kanban). Leaf and text directives are not currently used
// by the planning spec — if we need them later, add cases here.
//
// The hName/hProperties set here is what react-markdown reads to decide
// what HTML element to render. We use a `div` with `data-directive` so the
// preview can match it with a custom component override.

import type { Plugin } from "unified";
import type { Root } from "mdast";
import { visit } from "unist-util-visit";
// `Root` is imported as a type from `mdast`. The runtime `mdast` package
// is re-exported as types via the `@types/mdast` dependency that `unified`
// already pulls in; this `import type` is erased at build time.

interface DirectiveData {
  hName?: string;
  hProperties?: Record<string, unknown>;
}

const ALLOWED = new Set([
  "timeline",
  "details",
  "columns",
  "board",
  "kanban",
  "callout", // Also a directive form, in addition to > [!TYPE] blockquotes
]);

export const remarkPlanDirectives: Plugin<[], Root> = () => {
  return (tree) => {
    visit(tree, (node) => {
      if (
        node.type !== "containerDirective" &&
        node.type !== "leafDirective" &&
        node.type !== "textDirective"
      ) {
        return;
      }
      const name = (node as { name: string }).name;
      if (!ALLOWED.has(name)) {
        // Unknown directive — keep it as-is; react-markdown will render nothing
        // useful but we won't crash.
        return;
      }
      const data = (node.data ?? (node.data = {})) as DirectiveData;
      data.hName = "div";
      // Carry the directive name + label + attributes into a single hProperties
      // bag so the preview can read them.
      const n = node as unknown as {
        attributes?: Record<string, unknown>;
        children?: Array<{ value?: string }>;
      };
      const labelText = n.children
        ?.map((c) => (typeof c.value === "string" ? c.value : ""))
        .join("")
        .trim();
      data.hProperties = {
        "data-directive": name,
        ...(labelText ? { "data-label": labelText } : {}),
        ...(n.attributes && Object.keys(n.attributes).length > 0
          ? { "data-attrs": JSON.stringify(n.attributes) }
          : {}),
      };
    });
  };
};
