/**
 * Deterministic renderers that turn a DesignLanguageSpec into the three artifacts
 * consumed across the app:
 *   - renderThemeCss   → theme.css   (preview + token extraction; legacy-compatible names)
 *   - renderDesignMd   → DESIGN.md   (the generation brief injected via buildDesignBriefSection)
 *   - renderTokensJson → tokens.json (W3C DTCG export — Style Dictionary compatible)
 *
 * Pure functions — no IO, fully unit-testable.
 */

import {
  type DesignLanguageSpec,
  type ColorTokens,
  COLOR_TOKEN_KEYS,
  colorKeyToCssVar,
} from "./spec";

// ─── theme.css ──────────────────────────────────────────────────────────────────

function colorBlockLines(colors: ColorTokens, indent: string): string {
  return COLOR_TOKEN_KEYS.map((key) => `${indent}${colorKeyToCssVar(key)}: ${colors[key]};`).join("\n");
}

/**
 * Render the full theme.css: font @imports, then :root {} (light + all token families)
 * and .dark {} (color overrides). Emits the legacy shadcn token names (--background,
 * --primary, --radius, …) plus the extended families (--font-*, --text-*, --space-*,
 * --shadow-*, --ease-*, --duration-*), so existing consumers keep working unchanged.
 */
export function renderThemeCss(spec: DesignLanguageSpec): string {
  const { typography, spacing, radii, shadows, borders, motion } = spec;

  const imports = Array.from(
    new Set(
      Object.values(typography.fonts)
        .map((f) => f.googleFontImport)
        .filter((url): url is string => !!url && url.trim().length > 0),
    ),
  ).map((url) => `@import url('${url}');`);

  const fontLines = [
    `  --font-sans: '${typography.fonts.sans.family}', ${typography.fonts.sans.fallback};`,
    `  --font-serif: '${typography.fonts.serif.family}', ${typography.fonts.serif.fallback};`,
    `  --font-display: '${typography.fonts.display.family}', ${typography.fonts.display.fallback};`,
    `  --font-mono: '${typography.fonts.mono.family}', ${typography.fonts.mono.fallback};`,
  ];

  const textLines = Object.entries(typography.scale).map(([k, v]) => `  --text-${k}: ${v};`);
  const weightLines = Object.entries(typography.weights).map(([k, v]) => `  --font-weight-${k}: ${v};`);
  const leadingLines = Object.entries(typography.leading).map(([k, v]) => `  --leading-${k}: ${v};`);
  const trackingLines = Object.entries(typography.tracking).map(([k, v]) => `  --tracking-${k}: ${v};`);
  const spaceLines = Object.entries(spacing.scale).map(([k, v]) => `  --space-${k}: ${v};`);
  const radiusLines = Object.entries(radii).map(([k, v]) => `  --radius-${k}: ${v};`);
  const shadowLines = Object.entries(shadows).map(([k, v]) => `  --shadow-${k}: ${v};`);
  const durationLines = Object.entries(motion.durations).map(([k, v]) => `  --duration-${k}: ${v};`);
  const easingLines = Object.entries(motion.easings).map(([k, v]) => `  --ease-${k}: ${v};`);

  const root = [
    ":root {",
    colorBlockLines(spec.color.light, "  "),
    "",
    `  /* radius — --radius is the shadcn base token (mapped to the md step) */`,
    `  --radius: ${radii.md};`,
    ...radiusLines,
    "",
    `  /* typography */`,
    ...fontLines,
    ...textLines,
    ...weightLines,
    ...leadingLines,
    ...trackingLines,
    "",
    `  /* spacing */`,
    ...spaceLines,
    "",
    `  /* elevation + borders */`,
    ...shadowLines,
    `  --border-width: ${borders.width};`,
    `  --border-style: ${borders.style};`,
    "",
    `  /* motion */`,
    ...durationLines,
    ...easingLines,
    "}",
  ].join("\n");

  const dark = [".dark {", colorBlockLines(spec.color.dark, "  "), "}"].join("\n");

  const header = `/* ${spec.meta.name} — ${spec.meta.descriptor}\n   Generated design language. Edit in the Design panel; tokens.json is the export. */`;

  return [...(imports.length ? [imports.join("\n"), ""] : []), header, "", root, "", dark, ""].join("\n");
}

// ─── DESIGN.md ────────────────────────────────────────────────────────────────────

function bullets(items: string[], indent = ""): string {
  return items.map((i) => `${indent}- ${i}`).join("\n");
}

/**
 * Render the human + AI readable design brief. The heading structure mirrors the
 * DESIGN_BRIEF_TEMPLATES shape (so it slots into buildDesignBriefSection) but covers
 * every facet of the language.
 */
export function renderDesignMd(spec: DesignLanguageSpec): string {
  const { meta, typography, spacing, radii, shadows, borders, motion, iconography, layout, voice, content } = spec;

  const colorRows = COLOR_TOKEN_KEYS.map(
    (key) => `- \`${colorKeyToCssVar(key)}\`: ${spec.color.light[key]}  (dark: ${spec.color.dark[key]})`,
  );

  const fontRows = Object.entries(typography.fonts).map(
    ([role, f]) => `- **${role}**: ${f.family} (${f.fallback})`,
  );
  const scaleRows = Object.entries(typography.scale).map(([k, v]) => `- ${k}: ${v}`);

  const componentSections = spec.components.map((c) =>
    [
      `### ${c.name}`,
      c.description,
      "",
      "**Do**",
      bullets(c.do),
      "",
      "**Don't**",
      bullets(c.dont),
    ].join("\n"),
  );

  const contentExamples = content.examples.map((e) => `- ✅ ${e.good}\n  ❌ ${e.bad}`).join("\n");

  return [
    `# ${meta.name}`,
    `_${meta.descriptor}_`,
    "",
    meta.summary,
    "",
    "## Color",
    "Semantic tokens (light → dark). Use the CSS custom properties, never hardcode hex/rgb.",
    colorRows.join("\n"),
    "",
    "## Typography",
    ...fontRows,
    "",
    "**Type scale**",
    scaleRows.join("\n"),
    "",
    "**Weights**: " + Object.entries(typography.weights).map(([k, v]) => `${k} ${v}`).join(", "),
    "",
    "**Usage**",
    bullets(typography.usage),
    "",
    "## Spacing",
    `Base unit: ${spacing.base}. Scale: ${Object.entries(spacing.scale).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    "",
    "## Radii",
    Object.entries(radii).map(([k, v]) => `- ${k}: ${v}`).join("\n"),
    "",
    "## Elevation (shadows)",
    Object.entries(shadows).map(([k, v]) => `- ${k}: \`${v}\``).join("\n"),
    `Borders: ${borders.width} ${borders.style}`,
    "",
    "## Motion",
    `Durations: ${Object.entries(motion.durations).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    `Easings: ${Object.entries(motion.easings).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    bullets(motion.conventions),
    "",
    "## Components",
    ...componentSections,
    "",
    "## Iconography",
    `Library: ${iconography.library} · style: ${iconography.style} · stroke: ${iconography.strokeWidth} · size: ${iconography.size}`,
    bullets(iconography.usage),
    "",
    "## Layout & Grid",
    `${layout.gridColumns}-column grid, ${layout.gutter} gutter, max-width ${layout.maxWidth}.`,
    `Breakpoints: ${Object.entries(layout.breakpoints).map(([k, v]) => `${k}=${v}`).join(", ")}`,
    bullets(layout.principles),
    "",
    "## Voice & Tone",
    `Personality: ${voice.personality.join(", ")}. Tone: ${voice.tone}.`,
    bullets(voice.principles),
    "",
    "## Content Style",
    `- Capitalization: ${content.capitalization}`,
    `- Numbers: ${content.numbers}`,
    `- Dates: ${content.dates}`,
    `- Error messages: ${content.errorMessages}`,
    "",
    contentExamples,
    "",
    "## Anti-patterns",
    bullets(spec.antiPatterns),
    "",
  ].join("\n");
}

// ─── tokens.json (W3C DTCG) ──────────────────────────────────────────────────────

/** Parse "4px" / "1rem" / "0.5rem" → { value, unit } for DTCG dimension tokens. */
function toDimension(raw: string): { value: number; unit: string } | string {
  const match = raw.trim().match(/^(-?[\d.]+)(px|rem)$/);
  if (!match) return raw;
  return { value: parseFloat(match[1]), unit: match[2] };
}

type DtcgToken = { $type: string; $value: unknown; $description?: string };
type DtcgGroup = { [key: string]: DtcgToken | DtcgGroup };

function colorGroup(colors: ColorTokens): DtcgGroup {
  const group: DtcgGroup = {};
  for (const key of COLOR_TOKEN_KEYS) {
    group[key] = { $type: "color", $value: colors[key] };
  }
  return group;
}

/**
 * Render a W3C Design Tokens Format Module (2025.10) compatible token file.
 * Color values are emitted as oklch strings (a pragmatic extension); dimensions use
 * the spec's { value, unit } shape. Style Dictionary v4 reads this natively.
 */
export function renderTokensJson(spec: DesignLanguageSpec): string {
  const dims = (obj: Record<string, string>): DtcgGroup =>
    Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, { $type: "dimension", $value: toDimension(v) }]),
    );

  const doc = {
    $description: `${spec.meta.name} — ${spec.meta.descriptor}`,
    color: {
      light: colorGroup(spec.color.light),
      dark: colorGroup(spec.color.dark),
    },
    radius: dims(spec.radii),
    spacing: dims(spec.spacing.scale),
    fontSize: dims(spec.typography.scale),
    fontWeight: Object.fromEntries(
      Object.entries(spec.typography.weights).map(([k, v]) => [k, { $type: "fontWeight", $value: v }]),
    ),
    fontFamily: Object.fromEntries(
      Object.entries(spec.typography.fonts).map(([role, f]) => [
        role,
        { $type: "fontFamily", $value: [f.family, ...f.fallback.split(",").map((s) => s.trim())] },
      ]),
    ),
    shadow: Object.fromEntries(
      Object.entries(spec.shadows).map(([k, v]) => [k, { $type: "shadow", $value: v }]),
    ),
    duration: Object.fromEntries(
      Object.entries(spec.motion.durations).map(([k, v]) => {
        const match = v.trim().match(/^([\d.]+)(ms|s)$/);
        return [k, { $type: "duration", $value: match ? { value: parseFloat(match[1]), unit: match[2] } : v }];
      }),
    ),
  };

  return JSON.stringify(doc, null, 2) + "\n";
}
