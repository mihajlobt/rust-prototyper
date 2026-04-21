import { useRef, useEffect } from "react";
import CodeMirror from "codemirror";
import "codemirror/lib/codemirror.css";
import "codemirror/mode/javascript/javascript";
import "codemirror/mode/css/css";
import "codemirror/mode/jsx/jsx";
import "codemirror/mode/xml/xml";
import "codemirror/mode/shell/shell";

import "codemirror/theme/monokai.css";
import "codemirror/theme/dracula.css";
import "codemirror/theme/nord.css";
import "codemirror/theme/material.css";
import "codemirror/theme/ayu-dark.css";
import "codemirror/theme/vibrant-ink.css";
import "codemirror/theme/moxer.css";

export const CODE_THEMES = [
  { id: "monokai", label: "Neon" },
  { id: "dracula", label: "Dracula" },
  { id: "nord", label: "Nord" },
  { id: "material", label: "Material" },
  { id: "ayu-dark", label: "Ayu" },
  { id: "vibrant-ink", label: "Vibrant" },
  { id: "moxer", label: "Moxer" },
];

interface CodeMirrorEditorProps {
  value?: string;
  mode?: string;
  readOnly?: boolean;
  theme?: string;
  style?: React.CSSProperties;
}

export function CodeMirrorEditor({ value, mode, readOnly = true, theme, style }: CodeMirrorEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cmRef = useRef<CodeMirror.Editor | null>(null);

  useEffect(() => {
    if (!ref.current || typeof CodeMirror === "undefined") return;
    cmRef.current = CodeMirror(ref.current, {
      value: value || "",
      mode: mode || "javascript",
      theme: theme || "monokai",
      readOnly: readOnly,
      lineNumbers: true,
      lineWrapping: true,
      scrollbarStyle: "null",
      viewportMargin: Infinity,
    });
    return () => {
      if (cmRef.current) {
        cmRef.current.getWrapperElement().remove();
        cmRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (cmRef.current && theme) cmRef.current.setOption("theme", theme);
  }, [theme]);

  return <div ref={ref} style={{ fontSize: 12, flex: 1, minHeight: 0, ...style }} />;
}
