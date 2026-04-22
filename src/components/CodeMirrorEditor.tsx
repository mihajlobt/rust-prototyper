import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import type { Extension } from "@codemirror/state";

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
  mode?: string;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
}

export function CodeMirrorEditor({
  value,
  onChange,
  mode = "javascript",
  readOnly = false,
  className = "",
  placeholder,
}: CodeMirrorEditorProps) {
  const extensions = useMemo(() => {
    const ext = modeMap[mode];
    return ext ? [ext] : [];
  }, [mode]);

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
