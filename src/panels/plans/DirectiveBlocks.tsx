// Directive block renderers for the Plans preview.
// Alerts (> [!NOTE] etc.) are handled by remark-github-alerts + CSS — no React needed.
// Native <details> is rendered via rehype-raw HTML passthrough + CSS in globals.css.

import React from "react";

export function DirectiveDiv({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props}>{children}</div>;
}

// ─── Shared text extraction ───────────────────────────────────────────────────
// Used by HeadingTag in PlanPreview to build anchor IDs from React children.

export function collectText(node: React.ReactNode, sink: (s: string) => void): void {
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
