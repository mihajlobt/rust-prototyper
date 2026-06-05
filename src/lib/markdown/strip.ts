// Markdown → plain text via the canonical unified pipeline.
//
// Uses `remark-parse` (markdown → mdast), `strip-markdown` (mdast → text
// nodes), and `remark-stringify` (mdast → text). Equivalent to running the
// same parser the preview uses, then throwing away all formatting.

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkStrip from "strip-markdown";

export async function stripMarkdown(source: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkStrip)
    .use(remarkStringify)
    .process(source);
  return String(file);
}
