import type { Root, Element, ElementContent } from "hast";

function isDetailsElement(node: ElementContent): node is Element {
  return node.type === "element" && node.tagName === "details";
}

export function groupAdjacentDetails(children: ElementContent[]): ElementContent[] {
  const result: ElementContent[] = [];
  let run: Element[] = [];

  function flushRun() {
    if (run.length >= 2) {
      result.push({
        type: "element",
        tagName: "div",
        properties: { className: ["md-tabgroup"] },
        children: run,
      });
    } else {
      result.push(...run);
    }
    run = [];
  }

  for (const child of children) {
    if (isDetailsElement(child)) {
      run.push(child);
    } else {
      flushRun();
      result.push(child);
    }
  }
  flushRun();
  return result;
}

// walk walks the tree top-down, applying groupAdjacentDetails at each level.
// Skipping 'details' is correct: a <details> body's children are not a new
// sequence of top-level details blocks — only siblings at the same tree depth
// can form a tab group.  Skipping 'div' with className=md-tabgroup is also
// correct: those divs were created by this very transform and re-walking their
// children would cause infinite loops (the children are the same element refs).
function walk(node: Root | Element): void {
  if (!("children" in node)) return;
  node.children = groupAdjacentDetails(node.children as ElementContent[]) as (Root["children"] & Element["children"]);
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const el = child as Element;
    if (el.tagName === "details") continue;
    if (el.tagName === "div" && Array.isArray(el.properties?.className) && el.properties.className.includes("md-tabgroup")) continue;
    walk(el);
  }
}

export default function rehypeGroupDetails() {
  return (tree: Root) => {
    walk(tree);
    return tree;
  };
}
