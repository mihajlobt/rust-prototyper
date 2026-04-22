import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  abcdef, androidstudio, atomone, aura, bbedit, bespin,
  darcula, dracula, duotoneLight, duotoneDark,
  eclipse, githubLight, githubDark,
  gruvboxDark, gruvboxLight, kimbie, material,
  monokai, monokaiDimmed, noctisLilac, nord,
  okaidia, solarizedLight, solarizedDark,
  sublime, tokyoNight, tokyoNightDay, tokyoNightStorm,
  tomorrowNightBlue, vscodeDark, xcodeDark, xcodeLight,
} from "@uiw/codemirror-themes-all";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useSettings } from "@/hooks/useSettings";

const modeMap: Record<string, Extension> = {
  javascript: javascript(),
  jsx: javascript({ jsx: true }),
  typescript: javascript({ typescript: true }),
  tsx: javascript({ jsx: true, typescript: true }),
  css: css(),
  json: json(),
  markdown: markdown(),
  yaml: yaml(),
  shell: javascript(),
};

export const EDITOR_THEMES: Record<string, { label: string; ext: Extension; dark: boolean }> = {
  oneDark:          { label: "One Dark",           ext: oneDark,           dark: true  },
  vscodeDark:       { label: "VS Code Dark",        ext: vscodeDark,        dark: true  },
  dracula:          { label: "Dracula",             ext: dracula,           dark: true  },
  tokyoNight:       { label: "Tokyo Night",         ext: tokyoNight,        dark: true  },
  tokyoNightStorm:  { label: "Tokyo Night Storm",   ext: tokyoNightStorm,   dark: true  },
  tokyoNightDay:    { label: "Tokyo Night Day",     ext: tokyoNightDay,     dark: false },
  nord:             { label: "Nord",                ext: nord,              dark: true  },
  gruvboxDark:      { label: "Gruvbox Dark",        ext: gruvboxDark,       dark: true  },
  gruvboxLight:     { label: "Gruvbox Light",       ext: gruvboxLight,      dark: false },
  monokai:          { label: "Monokai",             ext: monokai,           dark: true  },
  monokaiDimmed:    { label: "Monokai Dimmed",      ext: monokaiDimmed,     dark: true  },
  sublime:          { label: "Sublime",             ext: sublime,           dark: true  },
  atomone:          { label: "Atom One",            ext: atomone,           dark: true  },
  aura:             { label: "Aura",                ext: aura,              dark: true  },
  androidstudio:    { label: "Android Studio",      ext: androidstudio,     dark: true  },
  darcula:          { label: "Darcula",             ext: darcula,           dark: true  },
  material:         { label: "Material",            ext: material,          dark: true  },
  noctisLilac:      { label: "Noctis Lilac",        ext: noctisLilac,       dark: false },
  tomorrowNightBlue:{ label: "Tomorrow Night Blue", ext: tomorrowNightBlue, dark: true  },
  githubDark:       { label: "GitHub Dark",         ext: githubDark,        dark: true  },
  githubLight:      { label: "GitHub Light",        ext: githubLight,       dark: false },
  solarizedDark:    { label: "Solarized Dark",      ext: solarizedDark,     dark: true  },
  solarizedLight:   { label: "Solarized Light",     ext: solarizedLight,    dark: false },
  duotoneDark:      { label: "Duotone Dark",        ext: duotoneDark,       dark: true  },
  duotoneLight:     { label: "Duotone Light",       ext: duotoneLight,      dark: false },
  bespin:           { label: "Bespin",              ext: bespin,            dark: true  },
  abcdef:           { label: "ABCDEF",              ext: abcdef,            dark: true  },
  okaidia:          { label: "Okaidia",             ext: okaidia,           dark: true  },
  kimbie:           { label: "Kimbie",              ext: kimbie,            dark: true  },
  bbedit:           { label: "BBEdit",              ext: bbedit,            dark: false },
  eclipse:          { label: "Eclipse",             ext: eclipse,           dark: false },
  xcodeLight:       { label: "Xcode Light",         ext: xcodeLight,        dark: false },
  xcodeDark:        { label: "Xcode Dark",          ext: xcodeDark,         dark: true  },
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
  const { settings } = useSettings();

  const extensions = useMemo(() => {
    const result: Extension[] = [];
    const lang = modeMap[mode];
    if (lang) result.push(lang);
    const themeEntry = EDITOR_THEMES[settings.editorTheme];
    if (themeEntry) result.push(themeEntry.ext);
    if (onBlur) result.push(EditorView.domEventHandlers({ blur: () => { onBlur(); } }));
    return result;
  }, [mode, settings.editorTheme, onBlur]);

  const handleChange = useCallback((val: string) => { onChange?.(val); }, [onChange]);

  const themeEntry = EDITOR_THEMES[settings.editorTheme];
  const isDark = themeEntry ? themeEntry.dark : true;

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={isDark ? "dark" : "light"}
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
