// PlanEditor — thin wrapper around `CodeMirrorEditor` that exposes the
// underlying `EditorView` via an imperative handle for the format toolbar.
//
// All theme, height, language, and chrome concerns are owned by
// `CodeMirrorEditor` (in `src/components/`). This file's job is:
//   1. The `EditorAction` dispatch API used by the format toolbar and the
//      command palette.
//   2. A `goToLine` action for the outline rail.
//   3. An `onCursorLineChange` callback so the outline rail can highlight
//      the active section as the user moves the caret.

import {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

export type EditorAction =
  | { type: "setHeading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { type: "wrap"; wrap: string }
  | { type: "insertLink" }
  | { type: "insertImage" }
  | { type: "prefixLines"; prefix: string }
  | { type: "insertBlock"; text: string }
  | { type: "insertAtCursor"; text: string }
  | { type: "goToLine"; line: number };

export interface SelectionInfo {
  text: string;
  from: number;
  to: number;
}

export interface PlanEditorHandle {
  dispatch: (action: EditorAction) => void;
  focus: () => void;
  getView: () => EditorView | null;
}

interface PlanEditorProps {
  value: string;
  onChange: (value: string) => void;
  lineNumbers?: boolean;
  placeholder?: string;
  className?: string;
  /**
   * Fires whenever the cursor moves or the doc changes, with the
   * 0-indexed line of the primary selection head.
   */
  onCursorLineChange?: (line: number) => void;
  /**
   * Fires whenever the primary selection changes. Null when the selection
   * is empty (caret only). Used by the floating "Add to chat" button.
   */
  onSelectionChange?: (info: SelectionInfo | null) => void;
  /** Extra CodeMirror extensions — autocomplete sources, etc. */
  extraExtensions?: Extension[];
}

export const PlanEditor = forwardRef<PlanEditorHandle, PlanEditorProps>(function PlanEditor(
  { value, onChange, lineNumbers = false, placeholder, className, onCursorLineChange, onSelectionChange, extraExtensions },
  ref,
) {
  const viewRef = useRef<EditorView | null>(null);

  const dispatch = useCallback(
    (action: EditorAction) => {
      const view = viewRef.current;
      if (!view) return;
      runAction(view, action, onChange);
    },
    [onChange],
  );

  const focus = useCallback(() => {
    viewRef.current?.focus();
  }, []);

  const getView = useCallback(() => viewRef.current, []);

  useImperativeHandle(ref, () => ({ dispatch, focus, getView }), [dispatch, focus, getView]);

  const onSelectionChangeRef = useRef(onSelectionChange);
  useEffect(() => { onSelectionChangeRef.current = onSelectionChange; }, [onSelectionChange]);

  const selectionExt = useMemo<Extension | null>(() => {
    if (!onCursorLineChange && !onSelectionChangeRef.current) return null;
    return EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        const sel = update.state.selection.main;
        if (onCursorLineChange) {
          const head = sel.head;
          const line = update.state.doc.lineAt(head).number - 1;
          onCursorLineChange(line);
        }
        if (onSelectionChangeRef.current) {
          if (sel.from === sel.to) {
            onSelectionChangeRef.current(null);
          } else {
            onSelectionChangeRef.current({
              text: update.state.sliceDoc(sel.from, sel.to),
              from: sel.from,
              to: sel.to,
            });
          }
        }
      }
    });
  }, [onCursorLineChange]);

  const composedExtensions = useMemo<Extension[]>(() => {
    const list: Extension[] = [];
    if (selectionExt) list.push(selectionExt);
    if (extraExtensions && extraExtensions.length > 0) list.push(...extraExtensions);
    return list;
  }, [selectionExt, extraExtensions]);

  return (
    <CodeMirrorEditor
      value={value}
      onChange={onChange}
      mode="markdown"
      height="100%"
      placeholder={placeholder}
      className={className}
      lineWrapping
      minimal={!lineNumbers}
      viewRef={viewRef}
      extraExtensions={composedExtensions}
    />
  );
});

// ─── Action implementations ──────────────────────────────────────────────────

function runAction(
  view: EditorView,
  action: EditorAction,
  onChange: (v: string) => void,
): void {
  switch (action.type) {
    case "setHeading":
      return setHeading(view, action.level, onChange);
    case "wrap":
      return wrapSelection(view, action.wrap, onChange);
    case "insertLink":
      return insertLink(view, onChange);
    case "insertImage":
      return insertImage(view, onChange);
    case "prefixLines":
      return prefixLines(view, action.prefix, onChange);
    case "insertBlock":
      return insertBlock(view, action.text, onChange);
    case "insertAtCursor":
      return insertAtCursor(view, action.text, onChange);
    case "goToLine":
      return goToLine(view, action.line);
  }
}

function setHeading(view: EditorView, level: 1 | 2 | 3 | 4 | 5 | 6, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);
  const newPrefix = "#".repeat(level) + " ";
  const headingRe = /^#{1,6}\s/;

  const changes: { from: number; to?: number; insert: string }[] = [];
  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
    const line = view.state.doc.line(lineNumber);
    const match = line.text.match(headingRe);
    if (match) {
      changes.push({ from: line.from, to: line.from + match[0].length, insert: newPrefix });
    } else {
      changes.push({ from: line.from, insert: newPrefix });
    }
  }
  view.dispatch({ changes });
  onChange(view.state.doc.toString());
  view.focus();
}

function wrapSelection(view: EditorView, wrap: string, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const before = sel.from;
  const after = sel.to;
  if (text.startsWith(wrap) && text.endsWith(wrap) && text.length >= wrap.length * 2) {
    const unwrapped = text.slice(wrap.length, text.length - wrap.length);
    view.dispatch({
      changes: { from: before, to: after, insert: unwrapped },
      selection: { anchor: before, head: before + unwrapped.length },
    });
  } else {
    const inner = text.length > 0 ? text : "";
    const inserted = `${wrap}${inner}${wrap}`;
    view.dispatch({
      changes: { from: before, to: after, insert: inserted },
      selection:
        text.length > 0
          ? { anchor: before + wrap.length, head: before + wrap.length + inner.length }
          : { anchor: before + wrap.length, head: before + wrap.length },
    });
  }
  onChange(view.state.doc.toString());
  view.focus();
}

function insertLink(view: EditorView, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const label = text || "link text";
  const inserted = `[${label}](url)`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: inserted },
    selection: { anchor: sel.from + label.length + 3, head: sel.from + label.length + 3 + 3 },
  });
  onChange(view.state.doc.toString());
  view.focus();
}

function insertImage(view: EditorView, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const text = view.state.sliceDoc(sel.from, sel.to);
  const alt = text || "image description";
  const inserted = `![${alt}](url)`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: inserted },
    selection: { anchor: sel.from + alt.length + 4, head: sel.from + alt.length + 4 + 3 },
  });
  onChange(view.state.doc.toString());
  view.focus();
}

function prefixLines(view: EditorView, prefix: string, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const startLine = view.state.doc.lineAt(sel.from);
  const endLine = view.state.doc.lineAt(sel.to);

  const allHave = Array.from({ length: endLine.number - startLine.number + 1 }).every(
    (_, offset) => {
      const lineAtOffset = view.state.doc.line(startLine.number + offset);
      if (prefix === "1. ") return /^\d+\.\s+/.test(lineAtOffset.text);
      return lineAtOffset.text.startsWith(prefix);
    },
  );
  const changes: { from: number; to?: number; insert: string }[] = [];
  if (allHave) {
    const unprefixRe = prefix === "1. " ? /^\d+\.\s+/ : new RegExp("^" + escapeRegExp(prefix));
    for (let lineNumber = endLine.number; lineNumber >= startLine.number; lineNumber--) {
      const line = view.state.doc.line(lineNumber);
      const match = line.text.match(unprefixRe);
      if (match) {
        changes.push({ from: line.from, to: line.from + match[0].length, insert: "" });
      }
    }
  } else {
    for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber++) {
      const line = view.state.doc.line(lineNumber);
      changes.push({ from: line.from, insert: prefix });
    }
  }
  view.dispatch({ changes });
  onChange(view.state.doc.toString());
  view.focus();
}

function insertBlock(view: EditorView, text: string, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  const beforeLine = view.state.doc.lineAt(Math.max(0, sel.from - 1));
  const prefix = beforeLine.text.trim() === "" ? "" : "\n";
  const fullInsert = `${prefix}${text}`;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: fullInsert },
    selection: { anchor: sel.from + fullInsert.length },
  });
  onChange(view.state.doc.toString());
  view.focus();
}

function insertAtCursor(view: EditorView, text: string, onChange: (v: string) => void): void {
  const sel = view.state.selection.main;
  view.dispatch({
    changes: { from: sel.from, to: sel.to, insert: text },
    selection: { anchor: sel.from + text.length },
  });
  onChange(view.state.doc.toString());
  view.focus();
}

function goToLine(view: EditorView, line: number): void {
  if (line < 1) line = 1;
  if (line > view.state.doc.lines) line = view.state.doc.lines;
  const lineInfo = view.state.doc.line(line);
  view.dispatch({
    selection: { anchor: lineInfo.from, head: lineInfo.from },
    effects: EditorView.scrollIntoView(lineInfo.from, { y: "center" }),
  });
  view.focus();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
