// Headings utilities shared across plan panels.
//
// `extractHeadingsFlat` walks the source line by line and returns a flat
// list of ATX headings with their absolute line numbers. Used by the
// command palette's "Goto section" command (which dispatches
// `goToLine`). Skips frontmatter, fenced code, and blockquote prefixes.
//
// `extractHeadingsTree` is a separate (tree-shaped, slugified) extractor
// used by `DesignToc` for nested navigation. The two functions are not
// merged because they have different output shapes and consumers.

export interface PlanHeading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** 0-indexed absolute line in the source. */
  line: number;
}

const FENCE_OPEN = /^---\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function extractHeadingsFlat(source: string): PlanHeading[] {
  const lines = source.split("\n");
  const result: PlanHeading[] = [];
  let inFrontmatter = false;
  let sawOpeningFence = false;
  let inCodeFence = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!sawOpeningFence && i === 0 && FENCE_OPEN.test(line)) {
      inFrontmatter = true;
      sawOpeningFence = true;
      continue;
    }
    if (inFrontmatter) {
      if (FENCE_OPEN.test(line)) inFrontmatter = false;
      continue;
    }

    if (/^```/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    const candidate = line.replace(/^>\s?/, "");
    const match = candidate.match(HEADING_RE);
    if (match) {
      result.push({
        level: match[1].length as PlanHeading["level"],
        text: match[2],
        line: i,
      });
    }
  }
  return result;
}
