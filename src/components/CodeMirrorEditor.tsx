import { useCallback, useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import { html } from "@codemirror/lang-html";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { StreamLanguage } from "@codemirror/language";
import { shell as shellMode } from "@codemirror/legacy-modes/mode/shell";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
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
import { useSettings } from "@/hooks/useSettings";

// ─── Language detection ────────────────────────────────────────────────────

const EXT_TO_MODE: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
  css: "css", scss: "css", less: "css",
  json: "json", jsonc: "json",
  md: "markdown", mdx: "markdown", markdown: "markdown",
  yaml: "yaml", yml: "yaml",
  sh: "shell", bash: "shell", zsh: "shell",
  html: "html", htm: "html", svg: "html",
  txt: "markdown",
  env: "shell",
  toml: "yaml",
  rs: "rust",
  py: "python",
};

export function getLanguageFromPath(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return EXT_TO_MODE[ext] ?? "javascript";
}

const shellExtension = StreamLanguage.define(shellMode);

const MODE_TO_EXT: Record<string, Extension> = {
  javascript: javascript(),
  jsx:        javascript({ jsx: true }),
  typescript: javascript({ typescript: true }),
  tsx:        javascript({ jsx: true, typescript: true }),
  css:        css(),
  json:       json(),
  markdown:   markdown(),
  yaml:       yaml(),
  shell:      shellExtension,
  html:       html(),
  rust:       rust(),
  python:     python(),
};

// ─── Theme registry ────────────────────────────────────────────────────────

export const EDITOR_THEMES: Record<string, { label: string; ext: Extension; dark: boolean }> = {
  oneDark:           { label: "One Dark",            ext: oneDark,            dark: true  },
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

// ─── Component ────────────────────────────────────────────────────────────

interface CodeMirrorEditorProps {
  value: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  /** Language mode string e.g. "tsx", "css". Ignored if `filename` is provided. */
  mode?: string;
  /** Auto-detect language from file extension. Takes precedence over `mode`. */
  filename?: string;
  readOnly?: boolean;
  className?: string;
  placeholder?: string;
  /** Editor height. Defaults to "100%". */
  height?: string;
  /** Soft-wrap long lines instead of scrolling horizontally. */
  lineWrapping?: boolean;
  /** Compact mode — no line numbers, no fold gutter. For inline/embedded editors. */
  minimal?: boolean;
}

export function CodeMirrorEditor({
  value,
  onChange,
  onBlur,
  mode = "javascript",
  filename,
  readOnly = false,
  className = "",
  placeholder,
  height = "100%",
  lineWrapping = false,
  minimal = false,
}: CodeMirrorEditorProps) {
  const { settings } = useSettings();

  const resolvedMode = filename ? getLanguageFromPath(filename) : mode;

  const extensions = useMemo(() => {
    const result: Extension[] = [];
    const lang = MODE_TO_EXT[resolvedMode];
    if (lang) result.push(lang);
    if (lineWrapping) result.push(EditorView.lineWrapping);
    if (onBlur) result.push(EditorView.domEventHandlers({ blur: () => { onBlur(); } }));
    return result;
  }, [resolvedMode, lineWrapping, onBlur]);

  const handleChange = useCallback((val: string) => { onChange?.(val); }, [onChange]);

  const themeEntry = EDITOR_THEMES[settings.editorTheme];
  const activeTheme = themeEntry ? themeEntry.ext : EDITOR_THEMES.oneDark.ext;

  return (
    <CodeMirror
      value={value}
      height={height}
      theme={activeTheme}
      extensions={extensions}
      onChange={handleChange}
      readOnly={readOnly}
      placeholder={placeholder}
      className={[height === "100%" ? "h-full" : "", "text-sm", className].join(" ").trim()}
      basicSetup={{
        lineNumbers: !minimal,
        highlightActiveLineGutter: !minimal,
        highlightActiveLine: !minimal,
        foldGutter: !minimal,
      }}
    />
  );
}
