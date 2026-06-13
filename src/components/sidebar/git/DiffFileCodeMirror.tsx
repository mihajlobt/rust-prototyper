import { useMemo } from "react";
import { unifiedMergeView } from "@codemirror/merge";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

interface DiffFileCodeMirrorProps {
  original: string;
  modified: string;
  filePath: string;
}

export function DiffFileCodeMirror({ original, modified, filePath }: DiffFileCodeMirrorProps) {
  const extraExtensions = useMemo(
    () => [
      unifiedMergeView({
        original,
        gutter: true,
        // Untracked files have no original — the whole document is one "inserted"
        // chunk, so per-char highlights would drown out syntax highlighting.
        highlightChanges: original.length > 0,
        syntaxHighlightDeletions: true,
        mergeControls: false,
        collapseUnchanged: {},
      }),
    ],
    [original]
  );

  return (
    <CodeMirrorEditor
      value={modified}
      filename={filePath}
      readOnly
      height="auto"
      extraExtensions={extraExtensions}
    />
  );
}
