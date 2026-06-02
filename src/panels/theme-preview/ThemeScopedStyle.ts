/**
 * Rewrites top-level `:root` and `.dark` selectors to `.theme-preview-scope`
 * so injected theme CSS only affects the preview container, not the app shell.
 *
 * Handles patterns the model commonly generates:
 *   :root { }               → .theme-preview-scope { }
 *   .dark { }               → .theme-preview-scope.dark { }
 *   :root, .dark { }        → .theme-preview-scope, .theme-preview-scope.dark { }
 *   .dark, :root { }        → .theme-preview-scope.dark, .theme-preview-scope { }
 *   :root:not(.dark) { }    → .theme-preview-scope { }   (modifier stripped)
 */
export function rescopeThemeCss(rawCss: string): string {
  if (!rawCss) return "";

  return rawCss
    // :root, .dark { } or :root , .dark { }  (any order)
    .replace(/:root\s*,\s*\.dark\s*\{/g, ".theme-preview-scope, .theme-preview-scope.dark {")
    .replace(/\.dark\s*,\s*:root\s*\{/g, ".theme-preview-scope.dark, .theme-preview-scope {")
    // :root with any trailing modifiers/pseudo-classes before { (e.g. :root:not(.dark))
    .replace(/:root[^{,]*\{/g, ".theme-preview-scope {")
    // standalone .dark — negative lookbehind avoids double-replacing already-scoped selectors
    .replace(/(?<!theme-preview-scope)\.dark\s*\{/g, ".theme-preview-scope.dark {");
}

/** Extracts CSS custom property declarations from a named selector block. */
export function parseTokenBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "\\s*\\{([^}]+)\\}"));
  if (!match) return {};
  const tokens: Record<string, string> = {};
  for (const line of match[1].split(";")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (prop.startsWith("--") && value) tokens[prop] = value;
  }
  return tokens;
}
