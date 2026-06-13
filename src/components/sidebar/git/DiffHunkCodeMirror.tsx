import { useMemo } from "react";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { diffHunkExtensions } from "@/lib/git/diffGutter";
import type { DiffHunk } from "@/lib/git/types";

interface DiffHunkCodeMirrorProps {
  hunk: DiffHunk;
  /** New (or old, for deletions) file path — used for syntax-highlighting language detection. */
  filePath: string;
}

/** Renders one unified-diff hunk as a read-only CodeMirror view with old/new
 *  line-number gutters, +/- markers, and add/remove line highlighting — like
 *  GitHub's or VS Code's diff view, with correct indentation and syntax colors. */
export function DiffHunkCodeMirror({ hunk, filePath }: DiffHunkCodeMirrorProps) {
  const text = useMemo(() => hunk.lines.map((l) => l.content).join("\n"), [hunk]);
  const extraExtensions = useMemo(() => diffHunkExtensions(text, hunk.lines), [text, hunk]);

  return (
    <CodeMirrorEditor
      value={text}
      filename={filePath}
      readOnly
      minimal
      height="auto"
      extraExtensions={extraExtensions}
    />
  );
}
