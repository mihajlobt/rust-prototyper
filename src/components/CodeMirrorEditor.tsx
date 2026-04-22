import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import {
  abcdef, abyss, androidstudio, andromeda, atomone, aura,
  basicDark, basicLight, bbedit, bespin,
  consoleDark, consoleLight, copilot,
  darcula, dracula, duotoneDark, duotoneLight,
  eclipse, githubDark, githubLight,
  gruvboxDark, gruvboxLight, kimbie,
  materialDark, materialLight,
  monokai, monokaiDimmed, noctisLilac, nord,
  okaidia, quietlight, red,
  solarizedDark, solarizedLight, sublime,
  tokyoNight, tokyoNightDay, tokyoNightStorm, tomorrowNightBlue,
  vscodeDark, vscodeLight,
  whiteDark, whiteLight,
  xcodeDark, xcodeLight,
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
  // Dark themes
  vscodeDark:        { label: "VS Code Dark",        ext: vscodeDark,        dark: true  },
  dracula:           { label: "Dracula",             ext: dracula,           dark: true  },
  tokyoNight:        { label: "Tokyo Night",         ext: tokyoNight,        dark: true  },
  tokyoNightStorm:   { label: "Tokyo Night Storm",   ext: tokyoNightStorm,   dark: true  },
  nord:              { label: "Nord",                ext: nord,              dark: true  },
  aura:              { label: "Aura",                ext: aura,              dark: true  },
  gruvboxDark:       { label: "Gruvbox Dark",        ext: gruvboxDark,       dark: true  },
  monokai:           { label: "Monokai",             ext: monokai,           dark: true  },
  monokaiDimmed:     { label: "Monokai Dimmed",      ext: monokaiDimmed,     dark: true  },
  sublime:           { label: "Sublime",             ext: sublime,           dark: true  },
  atomone:           { label: "Atom One",            ext: atomone,           dark: true  },
  androidstudio:     { label: "Android Studio",      ext: androidstudio,     dark: true  },
  andromeda:         { label: "Andromeda",           ext: andromeda,         dark: true  },
  abyss:             { label: "Abyss",               ext: abyss,             dark: true  },
  darcula:           { label: "Darcula",             ext: darcula,           dark: true  },
  materialDark:      { label: "Material Dark",       ext: materialDark,      dark: true  },
  tomorrowNightBlue: { label: "Tomorrow Night Blue", ext: tomorrowNightBlue, dark: true  },
  githubDark:        { label: "GitHub Dark",         ext: githubDark,        dark: true  },
  solarizedDark:     { label: "Solarized Dark",      ext: solarizedDark,     dark: true  },
  duotoneDark:       { label: "Duotone Dark",        ext: duotoneDark,       dark: true  },
  bespin:            { label: "Bespin",              ext: bespin,            dark: true  },
  abcdef:            { label: "ABCDEF",              ext: abcdef,            dark: true  },
  okaidia:           { label: "Okaidia",             ext: okaidia,           dark: true  },
  kimbie:            { label: "Kimbie",              ext: kimbie,            dark: true  },
  consoleDark:       { label: "Console Dark",        ext: consoleDark,       dark: true  },
  copilot:           { label: "Copilot",             ext: copilot,           dark: true  },
  basicDark:         { label: "Basic Dark",          ext: basicDark,         dark: true  },
  red:               { label: "Red",                 ext: red,               dark: true  },
  whiteDark:         { label: "White Dark",          ext: whiteDark,         dark: true  },
  xcodeDark:         { label: "Xcode Dark",          ext: xcodeDark,         dark: true  },
  // Light themes
  tokyoNightDay:     { label: "Tokyo Night Day",     ext: tokyoNightDay,     dark: false },
  gruvboxLight:      { label: "Gruvbox Light",       ext: gruvboxLight,      dark: false },
  githubLight:       { label: "GitHub Light",        ext: githubLight,       dark: false },
  solarizedLight:    { label: "Solarized Light",     ext: solarizedLight,    dark: false },
  duotoneLight:      { label: "Duotone Light",       ext: duotoneLight,      dark: false },
  noctisLilac:       { label: "Noctis Lilac",        ext: noctisLilac,       dark: false },
  materialLight:     { label: "Material Light",      ext: materialLight,     dark: false },
  bbedit:            { label: "BBEdit",              ext: bbedit,            dark: false },
  eclipse:           { label: "Eclipse",             ext: eclipse,           dark: false },
  xcodeLight:        { label: "Xcode Light",         ext: xcodeLight,        dark: false },
  vscodeLight:       { label: "VS Code Light",       ext: vscodeLight,       dark: false },
  quietlight:        { label: "Quiet Light",         ext: quietlight,        dark: false },
  consoleLight:      { label: "Console Light",       ext: consoleLight,      dark: false },
  basicLight:        { label: "Basic Light",         ext: basicLight,        dark: false },
  whiteLight:        { label: "White Light",         ext: whiteLight,        dark: false },
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
    if (onBlur) result.push(EditorView.domEventHandlers({ blur: () => { onBlur(); } }));
    return result;
  }, [mode, onBlur]);

  const handleChange = useCallback((val: string) => { onChange?.(val); }, [onChange]);

  const themeEntry = EDITOR_THEMES[settings.editorTheme];
  const activeTheme = themeEntry ? themeEntry.ext : "dark";

  return (
    <CodeMirror
      value={value}
      height="100%"
      theme={activeTheme}
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
