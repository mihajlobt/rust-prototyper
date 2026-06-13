import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, gutter, GutterMarker, EditorView } from "@codemirror/view";
import type { DiffHunkLine } from "./types";

const LINE_CLASS: Record<DiffHunkLine["type"], string | null> = {
  add: "cm-diff-line-add",
  remove: "cm-diff-line-remove",
  meta: "cm-diff-line-meta",
  context: null,
};

const GUTTER_ELEMENT_CLASS: Record<DiffHunkLine["type"], string | null> = {
  add: "cm-diff-gutter-add",
  remove: "cm-diff-gutter-remove",
  meta: "cm-diff-line-meta",
  context: null,
};

class LineNumberMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(readonly num: number | undefined, readonly type: DiffHunkLine["type"]) {
    super();
    this.elementClass = GUTTER_ELEMENT_CLASS[type] ?? "";
  }
  eq(other: LineNumberMarker) {
    return other.num === this.num && other.type === this.type;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-diff-linenum";
    span.textContent = this.num != null ? String(this.num) : "";
    return span;
  }
}

class MarkerGutterMarker extends GutterMarker {
  readonly elementClass: string;

  constructor(readonly type: DiffHunkLine["type"]) {
    super();
    this.elementClass = GUTTER_ELEMENT_CLASS[type] ?? "";
  }
  eq(other: MarkerGutterMarker) {
    return other.type === this.type;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = `cm-diff-marker cm-diff-marker-${this.type}`;
    span.textContent = this.type === "add" ? "+" : this.type === "remove" ? "-" : "";
    return span;
  }
}

function maxLineNo(lines: DiffHunkLine[], side: "old" | "new"): number {
  let max = 0;
  for (const l of lines) {
    const n = side === "old" ? l.oldLineNo : l.newLineNo;
    if (n != null && n > max) max = n;
  }
  return max;
}

function lineNumberGutter(lines: DiffHunkLine[], side: "old" | "new"): Extension {
  const spacer = new LineNumberMarker(maxLineNo(lines, side), "context");
  return gutter({
    class: `cm-diff-gutter cm-diff-gutter-${side}`,
    initialSpacer: () => spacer,
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const entry = lines[lineNo - 1];
      const num = side === "old" ? entry?.oldLineNo : entry?.newLineNo;
      return new LineNumberMarker(num, entry?.type ?? "context");
    },
  });
}

function markerGutter(lines: DiffHunkLine[]): Extension {
  return gutter({
    class: "cm-diff-gutter cm-diff-gutter-marker",
    lineMarker(view, line) {
      const lineNo = view.state.doc.lineAt(line.from).number;
      const entry = lines[lineNo - 1];
      return new MarkerGutterMarker(entry?.type ?? "context");
    },
  });
}

/** Per-line background highlighting for added/removed/meta diff lines. */
function lineHighlightExtension(text: string, lines: DiffHunkLine[]): Extension {
  const builder = new RangeSetBuilder<Decoration>();
  const textLines = text.split("\n");
  let pos = 0;
  for (let i = 0; i < textLines.length; i++) {
    const cls = LINE_CLASS[lines[i]?.type ?? "context"];
    if (cls) builder.add(pos, pos, Decoration.line({ class: cls }));
    pos += textLines[i].length + 1;
  }
  return EditorView.decorations.of(builder.finish());
}

/**
 * CodeMirror extensions rendering a unified diff hunk like GitHub/VS Code:
 * old/new line-number gutters, a +/- marker gutter, and add/remove/meta line
 * backgrounds. `text` must equal `lines.map(l => l.content).join("\n")`.
 */
export function diffHunkExtensions(text: string, lines: DiffHunkLine[]): Extension[] {
  return [
    lineNumberGutter(lines, "old"),
    lineNumberGutter(lines, "new"),
    markerGutter(lines),
    lineHighlightExtension(text, lines),
  ];
}
