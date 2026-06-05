// OutlineRail — right rail showing the table of contents of a plan.
//
// Pure function `extractHeadings(source)` walks the source string line by
// line, skipping frontmatter and fenced code, and returns every ATX heading
// with its absolute line index. Strikethrough-friendly: it handles `## ###`
// inside `> ` blockquote prefixes and `#` inside task list items is not
// considered a heading (task items are `- [ ] #…`, not `# …`).
//
// Clicking a heading dispatches `{ type: "goToLine" }` on the editor handle.
// The active heading is derived from the editor's current selection line,
// polled via a small `onCursorLineChange` callback — not via a scroll-spy
// of the rendered preview, because the editor is the source of truth.

import { ListTree } from "lucide-react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { type EditorAction } from "./PlanEditor";

export interface Heading {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  /** Absolute line index in the source (0-based). */
  line: number;
}

const FENCE_OPEN = /^---\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

export function extractHeadings(source: string): Heading[] {
  const lines = source.split("\n");
  const result: Heading[] = [];
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

    // Strip a single blockquote prefix for the heading check — `> # H` is still a heading
    const candidate = line.replace(/^>\s?/, "");
    const match = candidate.match(HEADING_RE);
    if (match) {
      result.push({ level: match[1].length as Heading["level"], text: match[2], line: i });
    }
  }
  return result;
}

interface OutlineRailProps {
  source: string;
  currentLine: number;
  onJump: (action: EditorAction) => void;
}

export function OutlineRail({ source, currentLine, onJump }: OutlineRailProps) {
  const headings = extractHeadings(source);
  const activeLine = activeHeadingLine(headings, currentLine);

  return (
    <aside className="flex h-full w-full flex-col border-l border-border bg-card">
      <OutlineRailHeader count={headings.length} />
      <ScrollArea className="min-h-0 flex-1">
        {headings.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-muted-foreground">
            No headings yet.
          </div>
        ) : (
          <ol className="flex flex-col gap-0.5 p-2">
            {headings.map((h) => {
              const isActive = h.line === activeLine;
              return (
                <li key={`${h.line}-${h.text}`}>
                  <button
                    type="button"
                    onClick={() => onJump({ type: "goToLine", line: h.line })}
                    className={cn(
                      "flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-[11px] transition-colors hover:bg-muted",
                      isActive && "bg-muted text-foreground",
                    )}
                    style={{ paddingLeft: `${(h.level - 1) * 10 + 8}px` }}
                  >
                    <span
                      className={cn(
                        "shrink-0 font-mono text-[9px] text-muted-foreground/60",
                        h.level === 1 && "text-violet-400",
                        h.level === 2 && "text-violet-300",
                        h.level === 3 && "text-muted-foreground",
                      )}
                    >
                      H{h.level}
                    </span>
                    <span className="truncate">{h.text}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </ScrollArea>
    </aside>
  );
}

/**
 * The "active" heading is the deepest heading whose `line` is `<= currentLine`.
 * If the cursor is before the first heading, returns -1 (no active highlight).
 */
function activeHeadingLine(headings: Heading[], currentLine: number): number {
  let best = -1;
  for (const h of headings) {
    if (h.line <= currentLine) {
      best = h.line;
    } else {
      break;
    }
  }
  return best;
}

function OutlineRailHeader({ count }: { count: number }) {
  return (
    <header className="flex h-10 shrink-0 items-center border-b border-border px-3">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <ListTree size={12} />
        <span>Outline</span>
      </div>
      <span className="ml-auto text-[10px] text-muted-foreground/60">{count}</span>
    </header>
  );
}
