import { useEffect, useState } from "react";
import * as Babel from "@babel/standalone";
import { readFile, getErrorMessage } from "@/lib/ipc";
import {
  type IconLibrary,
  ICON_LIBRARY_PACKAGES,
  ICON_LIBRARY_CSS_PATHS,
} from "@/lib/prompts";

export interface PreviewOptions {
  fullBleed?: boolean;
  project?: string;
}

export function transformTsx(
  code: string,
): { js: string; error?: undefined } | { js?: undefined; error: string } {
  try {
    let stripped = code;

    // Strip React imports (React is global in the preview)
    stripped = stripped
      .replace(/^import\s+(?:type\s+)?.*?from\s+['"]react['"]\s*;?\s*$/gm, "")
      .replace(/^import\s+['"]react['"]\s*;?\s*$/gm, "");

    // Rewrite lucide-react imports to window.parent.__IconLib (__IconLib = Lucide
    // is always set in main.tsx). Do this when iconLibrary is "lucide" (expected),
    // or as a fallback when the model included lucide imports despite a different
    // library being selected — silently failing ("Can't find variable: Home") is
    // worse than resolving them.
    stripped = stripped.replace(
      /^import\s+\{([^}]+)\}\s+from\s+['"]lucide-react['"]\s*;?\s*$/gm,
      (_, names: string) => {
        const fixed = names.replace(/\b(\w+)\s+as\s+(\w+)\b/g, "$1: $2");
        return `var { ${fixed} } = window.parent.__IconLib;`;
      }
    );
    stripped = stripped.replace(
      /^import\s+(\w+)\s+from\s+['"]lucide-react['"]\s*;?\s*$/gm,
      (_, name) => `var ${name} = window.parent.__IconLib.${name};`
    );

    // Strip any remaining imports
    stripped = stripped
      .replace(/^import\s+(?:type\s+)?.*?from\s+['"].*?['"]\s*;?\s*$/gm, "")
      .replace(/^import\s+['"].*?['"]\s*;?\s*$/gm, "");

    // Handle exports
    stripped = stripped
      .replace(/^export\s+default\s+/m, "const __DefaultExport = ")
      .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, "")
      .replace(/^export\s+(const|function|class|let|var)\s+/gm, "$1 ");

    const result = Babel.transform(stripped, {
      presets: [
        ["react", { runtime: "classic" }],
        ["typescript", { allExtensions: true, isTSX: true }],
      ],
      filename: "component.tsx",
    });
    return { js: result.code ?? "" };
  } catch (e) {
    return { error: getErrorMessage(e) };
  }
}

/** Collect parent app CSS (Tailwind + theme tokens) */
export function getParentCss(): string {
  return Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((r) => r.cssText);
      } catch {
        return [];
      }
    })
    .join("\n");
}

/** Load icon font CSS from generated/node_modules */
export async function getIconFontCss(
  iconLibrary: IconLibrary,
  project: string
): Promise<string> {
  if (iconLibrary === "none" || iconLibrary === "lucide") return "";
  const pkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  const cssPath = ICON_LIBRARY_CSS_PATHS[iconLibrary];
  if (!pkg || !cssPath) return "";
  try {
    return await readFile(
      `projects/${project}/generated/node_modules/${pkg}/${cssPath}`
    );
  } catch {
    return "";
  }
}

/** Execute compiled preview code and return the component function.
 *  The compiled code runs inside a small sandbox where React is available.
 */
function extractComponent(js: string): React.ComponentType | null {
  const ParentReact = (window as unknown as Record<string, unknown>).__React as typeof import("react");
  if (!ParentReact) return null;

  // Scan compiled code for function declarations (e.g. function App() {}, function ProfileCard() {})
  // Babel preserves these names in the output.
  const declaredNames = Array.from(js.matchAll(/function\s+([A-Z]\w+)\s*\(/g)).map(m => m[1]);

  const runner = new Function(
    "React",
    `
    var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback,
        useRef = React.useRef, useMemo = React.useMemo, useContext = React.useContext,
        useReducer = React.useReducer, useLayoutEffect = React.useLayoutEffect;

    ${js}

    if (typeof __DefaultExport !== "undefined" && typeof __DefaultExport === "function") return __DefaultExport;
    if (typeof App !== "undefined" && typeof App === "function") return App;
    ${declaredNames.map(n => `if (typeof ${n} !== "undefined" && typeof ${n} === "function") return ${n};`).join("\n    ")}
    return null;
    `
  );

  try {
    return runner(ParentReact);
  } catch {
    return null;
  }
}

/** Create a React component that renders compiled preview code inside a Frame.
 *  Pattern from: https://github.com/ryanseddon/react-frame-component/blob/master/example/app.jsx
 */
export function createPreviewComponent(
  code: string,
): React.ComponentType {
  const { js, error } = transformTsx(code);

  if (error || !js) {
    return function ErrorPreview() {
      return (
        <div style={{ color: "#f87171", fontSize: 12, padding: 12, fontFamily: "monospace" }}>
          {error || "Compilation error"}
        </div>
      );
    };
  }

  const Comp = extractComponent(js);

  if (!Comp) {
    return function ErrorPreview() {
      return <div style={{ color: "#888", fontSize: 12, padding: 12 }}>No component found in generated code</div>;
    };
  }

  return Comp;
}

/** Hook to load icon font CSS */
export function useIconFontCss(iconLibrary: IconLibrary, project: string): string {
  const [css, setCss] = useState("");
  useEffect(() => {
    if (iconLibrary === "none" || iconLibrary === "lucide") {
      setCss("");
      return;
    }
    let cancelled = false;
    getIconFontCss(iconLibrary, project).then((c) => {
      if (!cancelled) setCss(c);
    });
    return () => { cancelled = true; };
  }, [iconLibrary, project]);
  return css;
}

export function extractCode(text: string): string | null {
  // Match any language fence (html, tsx, css, etc.) or bare triple backticks
  const fenced = text.match(/```\w*\s*\n([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const trimmed = text.trim();
  if (
    trimmed.startsWith("import ") ||
    trimmed.startsWith("export ") ||
    trimmed.startsWith("function ") ||
    trimmed.startsWith("const ") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    // CSS content: selectors, at-rules, or property declarations
    trimmed.startsWith(":root") ||
    trimmed.startsWith(".dark") ||
    trimmed.match(/^\.[a-zA-Z_-]/) !== null ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("*") ||
    trimmed.startsWith("body") ||
    trimmed.startsWith("html {") ||
    trimmed.match(/^[a-zA-Z-]+\s*[{:]/) !== null
  ) {
    return trimmed;
  }
  return null;
}

/** Build a raw HTML document for iframe srcDoc (used by Themes panel) */
export async function buildPreviewDoc(
  code: string,
  dark: boolean,
  iconLibrary: IconLibrary = "none",
  options: PreviewOptions = {}
): Promise<string> {
  const { js, error } = transformTsx(code);
  const cssText = getParentCss();
  const iconFontCss = options.project
    ? await getIconFontCss(iconLibrary, options.project)
    : "";
  const bg = dark ? "#0f0f0f" : "#ffffff";
  const fg = dark ? "#f1f5f9" : "#0f172a";
  const rootPadding = options.fullBleed ? "0" : "16px";

  if (error) {
    return `<!DOCTYPE html><html><body style="margin:0;padding:12px;background:${bg};font-family:monospace">
<pre style="color:#f87171;font-size:12px;white-space:pre-wrap">${error.replace(/</g, "&lt;")}</pre>
</body></html>`;
  }

  const safeJs = js!.replace(/<\/script>/gi, "<\\/script>");

  return `<!DOCTYPE html>
<html class="${dark ? "dark" : ""}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; background: ${bg}; color: ${fg}; font-family: system-ui, sans-serif; }
  ${cssText}
  ${iconFontCss}
</style>
</head>
<body>
<div id="root" style="padding:${rootPadding}"></div>
<script>
(function() {
  var React = window.parent.__React;
  var ReactDOM = window.parent.__ReactDOM;
  if (!React || !ReactDOM) {
    document.getElementById('root').innerHTML = '<p style="color:#f87171;font-size:12px">React not available</p>';
    return;
  }
  var useState = React.useState, useEffect = React.useEffect, useCallback = React.useCallback,
      useRef = React.useRef, useMemo = React.useMemo, useContext = React.useContext,
      useReducer = React.useReducer, useLayoutEffect = React.useLayoutEffect;
  try {
    ${safeJs}
    var __Comp = typeof __DefaultExport !== 'undefined' ? __DefaultExport : (typeof App !== 'undefined' ? App : null);
    if (__Comp) {
      ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__Comp));
    } else {
      document.getElementById('root').innerHTML = '<p style="color:#888;padding:8px">No default export found</p>';
    }
  } catch(e) {
    document.getElementById('root').innerHTML = '<pre style="color:#f87171;font-size:11px;padding:8px;white-space:pre-wrap">' + String(e) + '</pre>';
  }
})();
</script>
</body>
</html>`;
}
