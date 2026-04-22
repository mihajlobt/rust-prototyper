import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

const modeMap: Record<string, Extension> = {
  javascript: javascript(),
  jsx: javascript({ jsx: true }),
  typescript: javascript({ typescript: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  css: css(),
  json: json(),
  markdown: markdown(),
  shell: javascript(),
};

interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  mode?: string;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function CodeMirrorEditor({
  value,
  onChange,
  onBlur,
  mode = "javascript",
  readOnly = false,
  className = "",
  placeholder,
}: CodeMirrorEditorProps) {
  const extensions = useMemo(() => {
    const ext = modeMap[mode];
    const result: Extension[] = ext ? [ext] : [];
    if (onBlur) {
      result.push(EditorView.domEventHandlers({ blur: () => { onBlur(); } }));
    }
    return result;
  }, [mode, onBlur]);

  const handleChange = useCallback(
    (val: string) => {
      onChange?.(val);
    },
    [onChange]
  );

  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={extensions}
      onChange={handleChange}
      readOnly={readOnly}
      placeholder={placeholder}
      className={["h-full text-sm", className].join(" ")}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLineGutter: true,
        highlightActiveLine: true,
        foldGutter: true,
      }}
    />
  );
}