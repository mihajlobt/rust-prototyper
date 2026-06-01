/** Replaces :root {} → .theme-preview-scope {} and .dark {} → .theme-preview-scope.dark {}
 *  so injected theme CSS only affects the preview container, not the app shell. */
export function rescopeThemeCss(rawCss: string): string {
  if (!rawCss) return "";
  return rawCss
    .replace(/:root\s*\{/g, ".theme-preview-scope {")
    .replace(/\.dark\s*\{/g, ".theme-preview-scope.dark {");
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
