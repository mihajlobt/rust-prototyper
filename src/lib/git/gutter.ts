import { diffLines } from "diff";
import { StateEffect, StateField, RangeSet } from "@codemirror/state";
import { gutter, GutterMarker } from "@codemirror/view";

export type GutterChangeType = "add" | "modify" | "remove";

export interface GutterLineChange {
  line: number; // 1-indexed line number in the current (new) document
  type: GutterChangeType;
}

class ChangeMarker extends GutterMarker {
  constructor(readonly type: GutterChangeType) {
    super();
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = `cm-git-gutter-marker cm-git-gutter-${this.type}`;
    return el;
  }
}

const ADDED_MARKER = new ChangeMarker("add");
const MODIFIED_MARKER = new ChangeMarker("modify");
const REMOVED_MARKER = new ChangeMarker("remove");

function markerFor(type: GutterChangeType): ChangeMarker {
  if (type === "add") return ADDED_MARKER;
  if (type === "modify") return MODIFIED_MARKER;
  return REMOVED_MARKER;
}

export const gitGutterEffect = StateEffect.define<GutterLineChange[]>();

export const gitGutterField = StateField.define<RangeSet<GutterMarker>>({
  create() {
    return RangeSet.empty;
  },
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(gitGutterEffect)) {
        const doc = tr.state.doc;
        const ranges = effect.value
          .filter((change) => change.line >= 1 && change.line <= doc.lines)
          .map((change) => {
            const pos = doc.line(change.line).from;
            return { from: pos, to: pos, value: markerFor(change.type) };
          })
          .sort((a, b) => a.from - b.from);
        return RangeSet.of(ranges, true);
      }
    }
    if (tr.docChanged) return value.map(tr.changes);
    return value;
  },
});

/** Module-level constant — stable reference for CodeMirrorEditor's `extraExtensions`. */
export const gitGutterExtension = [
  gitGutterField,
  gutter({
    class: "cm-git-gutter",
    markers: (view) => view.state.field(gitGutterField),
  }),
];

/** Diffs `oldText` (HEAD content) against `newText` (current editor content) and
 *  returns per-line change markers positioned against the current document. */
export function computeGutterChanges(oldText: string, newText: string): GutterLineChange[] {
  const parts = diffLines(oldText, newText);
  const changes: GutterLineChange[] = [];
  let newLine = 1;
  let pendingRemoval = false;

  for (const part of parts) {
    const count = part.count ?? 0;
    if (part.removed) {
      pendingRemoval = true;
      continue;
    }
    if (part.added) {
      const type: GutterChangeType = pendingRemoval ? "modify" : "add";
      for (let i = 0; i < count; i++) changes.push({ line: newLine + i, type });
      newLine += count;
      pendingRemoval = false;
      continue;
    }
    if (pendingRemoval) {
      changes.push({ line: Math.max(newLine - 1, 1), type: "remove" });
      pendingRemoval = false;
    }
    newLine += count;
  }
  if (pendingRemoval) changes.push({ line: Math.max(newLine - 1, 1), type: "remove" });

  return changes;
}
