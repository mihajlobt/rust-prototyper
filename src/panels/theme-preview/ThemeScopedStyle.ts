const SCOPE = "theme-preview-scope";

/**
 * Extracts :root and .dark block bodies from generated theme CSS and rewrites
 * them as scoped selectors. The browser's CSS parser handles the block content
 * — no per-property parsing, no comment stripping, no edge-case handling.
 */
export function buildScopedThemeCss(css: string): string {
  if (!css) return "";
  const parts: string[] = [];
  const rootRe = /:root[^{,]*\{([^}]*)\}/g;
  const darkRe = /\.dark[^{,]*\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = rootRe.exec(css)) !== null) parts.push(`.${SCOPE} {${m[1]}}`);
  while ((m = darkRe.exec(css)) !== null) parts.push(`.${SCOPE}.dark {${m[1]}}`);
  return parts.join("\n");
}

export { SCOPE as THEME_PREVIEW_SCOPE };

/** Extracts CSS custom property declarations from a named selector block.
 *  Used by ColorSwatchGrid and TypographyShowcase to display token values. */
export function parseTokenBlock(css: string, selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(escaped + "[^{,]*\\{([^}]+)\\}"));
  if (!match) return {};
  const tokens: Record<string, string> = {};
  for (const raw of match[1].split(";")) {
    const line = raw.replace(/\/\*[\s\S]*?\*\//g, "").trim();
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const prop = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (prop.startsWith("--") && value) tokens[prop] = value;
  }
  return tokens;
}
