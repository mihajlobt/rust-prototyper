import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { MergeView } from "@codemirror/merge";
import { EDITOR_THEMES, getLanguageExtension } from "@/components/CodeMirrorEditor";
import { useSettings } from "@/hooks/useSettings";

interface DiffFileMergeViewProps {
  original: string;
  modified: string;
  filePath: string;
}

export function DiffFileMergeView({ original, modified, filePath }: DiffFileMergeViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettings();

  useEffect(() => {
    if (!containerRef.current) return;

    const themeEntry = EDITOR_THEMES[settings.editorTheme];
    const theme = themeEntry ? themeEntry.ext : EDITOR_THEMES.oneDark.ext;
    const lang = getLanguageExtension(filePath);

    const sharedExtensions: Extension[] = [
      basicSetup,
      theme,
      EditorView.lineWrapping,
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      ...(lang ? [lang] : []),
    ];

    const view = new MergeView({
      a: { doc: original, extensions: sharedExtensions },
      b: { doc: modified, extensions: sharedExtensions },
      parent: containerRef.current,
      gutter: true,
      collapseUnchanged: {},
    });

    return () => view.destroy();
  }, [original, modified, filePath, settings.editorTheme]);

  return <div ref={containerRef} className="text-sm cm-diff-split" />;
}
