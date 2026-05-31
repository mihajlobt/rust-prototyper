/**
 * DesignLanguageSpec — the structured source of truth for a generated design language.
 *
 * A single spec is persisted as `design.json` inside a theme folder, alongside the
 * `theme.css` and `DESIGN.md` the model writes directly during design-language
 * generation, so the visual tokens and the written guidelines stay together.
 *
 * The token facets (color/typography/spacing/radii/shadows/borders/motion) map to the
 * W3C Design Tokens Format Module 2025.10 types (color, dimension, fontFamily, fontWeight,
 * duration, cubicBezier, shadow). The guideline facets (components/iconography/layout/
 * voice/content/antiPatterns) describe the DESIGN.md brief.
 * Spec backbone: https://www.designtokens.org/tr/drafts/format/
 */

import { z } from "zod";

// ─── Color ────────────────────────────────────────────────────────────────────
// Semantic color keys. These are the EXACT names existing consumers expect — the
// renderer maps camelCase → kebab CSS vars (cardForeground → --card-foreground) so
// extractDesignTokenNames() and preview-theme.css keep working verbatim.

export const COLOR_TOKEN_KEYS = [
  "background", "foreground",
  "card", "cardForeground",
  "popover", "popoverForeground",
  "primary", "primaryForeground",
  "secondary", "secondaryForeground",
  "muted", "mutedForeground",
  "accent", "accentForeground",
  "destructive", "destructiveForeground",
  "border", "input", "ring",
] as const;

/** Maps a spec color key (camelCase) to its CSS custom-property name. */
export function colorKeyToCssVar(key: string): string {
  return "--" + key.replace(/([A-Z])/g, "-$1").toLowerCase();
}

const oklch = z
  .string()
  .describe("An oklch() color, e.g. 'oklch(0.62 0.19 259)'. Always use oklch — never hex/rgb.");

const colorTokensSchema = z.object(
  Object.fromEntries(COLOR_TOKEN_KEYS.map((key) => [key, oklch])) as Record<
    (typeof COLOR_TOKEN_KEYS)[number],
    typeof oklch
  >,
);

export type ColorTokens = z.infer<typeof colorTokensSchema>;

// ─── Typography ─────────────────────────────────────────────────────────────────

const fontSchema = z.object({
  family: z.string().describe("CSS font-family name, e.g. 'Inter'"),
  fallback: z.string().describe("Fallback stack, e.g. 'system-ui, sans-serif'"),
  googleFontImport: z
    .string()
    .nullable()
    .describe("Full Google Fonts @import URL for this family, or null if a system font"),
});

const typographySchema = z.object({
  fonts: z.object({
    sans: fontSchema,
    serif: fontSchema,
    display: fontSchema.describe("Display/heading font"),
    mono: fontSchema,
  }),
  scale: z
    .object({
      xs: z.string(), sm: z.string(), base: z.string(), lg: z.string(),
      xl: z.string(), "2xl": z.string(), "3xl": z.string(), "4xl": z.string(),
    })
    .describe("Type scale as rem/px strings, e.g. base '1rem'"),
  weights: z.object({
    normal: z.number(), medium: z.number(), semibold: z.number(), bold: z.number(),
  }),
  leading: z
    .object({ tight: z.string(), normal: z.string(), relaxed: z.string() })
    .describe("line-height values, e.g. normal '1.5'"),
  tracking: z
    .object({ tight: z.string(), normal: z.string(), wide: z.string() })
    .describe("letter-spacing values in em, e.g. tight '-0.02em'"),
  usage: z.array(z.string()).describe("Guidelines: when to use display vs sans, hierarchy rules"),
});

// ─── Spacing / radii / shadows / borders / motion ────────────────────────────────

const spacingSchema = z.object({
  base: z.string().describe("Base spacing unit, e.g. '4px'"),
  scale: z.object({
    xs: z.string(), sm: z.string(), md: z.string(), lg: z.string(),
    xl: z.string(), "2xl": z.string(), "3xl": z.string(),
  }),
});

const radiiSchema = z.object({
  sm: z.string(), md: z.string(), lg: z.string(), full: z.string(),
});

const shadowsSchema = z
  .object({ sm: z.string(), md: z.string(), lg: z.string(), xl: z.string() })
  .describe("Full CSS box-shadow values, e.g. md '0 4px 6px -1px rgb(0 0 0 / 0.1)'");

const bordersSchema = z.object({
  width: z.string().describe("Default border width, e.g. '1px'"),
  style: z.string().describe("Default border style, e.g. 'solid'"),
});

const motionSchema = z.object({
  durations: z
    .object({ fast: z.string(), normal: z.string(), slow: z.string() })
    .describe("Durations in ms, e.g. normal '200ms'"),
  easings: z
    .object({ standard: z.string(), emphasized: z.string(), decelerate: z.string() })
    .describe("cubic-bezier() easing curves"),
  conventions: z.array(z.string()).describe("Motion guidelines: what animates, when, how much"),
});

// ─── Guideline facets (render to DESIGN.md) ──────────────────────────────────────

const componentSchema = z.object({
  name: z.string().describe("Component name, e.g. 'Button', 'Card', 'Input'"),
  description: z.string(),
  do: z.array(z.string()).describe("Do rules"),
  dont: z.array(z.string()).describe("Don't rules / anti-patterns for this component"),
});

const iconographySchema = z.object({
  library: z
    .enum(["lucide", "tabler", "fontawesome", "bootstrap", "material", "none"])
    .describe("Icon library to use"),
  strokeWidth: z.string().describe("Stroke weight, e.g. '1.5' or 'n/a' for filled sets"),
  size: z.string().describe("Default icon size, e.g. '20px'"),
  style: z.string().describe("Visual style: outline, filled, duotone, etc."),
  usage: z.array(z.string()),
});

const layoutSchema = z.object({
  gridColumns: z.number().describe("Base grid column count, e.g. 12"),
  gutter: z.string().describe("Grid gutter, e.g. '24px'"),
  maxWidth: z.string().describe("Content max-width, e.g. '1280px'"),
  breakpoints: z.object({ sm: z.string(), md: z.string(), lg: z.string(), xl: z.string() }),
  principles: z.array(z.string()).describe("Layout/composition principles"),
});

const voiceSchema = z.object({
  personality: z.array(z.string()).describe("Personality adjectives, e.g. 'confident', 'warm'"),
  tone: z.string().describe("Overall tone description"),
  principles: z.array(z.string()).describe("Voice principles"),
});

const contentSchema = z.object({
  capitalization: z.string().describe("Capitalization convention, e.g. 'sentence case for everything'"),
  numbers: z.string().describe("Number/units formatting convention"),
  dates: z.string().describe("Date formatting convention"),
  errorMessages: z.string().describe("How error messages should read"),
  examples: z
    .array(z.object({ good: z.string(), bad: z.string() }))
    .describe("Good vs bad microcopy examples"),
});

// ─── Top-level spec ───────────────────────────────────────────────────────────

export const designLanguageSpecSchema = z.object({
  meta: z.object({
    name: z.string().describe("Short name for the design language"),
    descriptor: z.string().describe("One-line descriptor"),
    archetype: z.string().nullable().describe("Archetype seed this was based on, or null"),
    summary: z.string().describe("2-4 sentence summary of the design philosophy"),
  }),
  color: z.object({
    light: colorTokensSchema,
    dark: colorTokensSchema,
  }),
  typography: typographySchema,
  spacing: spacingSchema,
  radii: radiiSchema,
  shadows: shadowsSchema,
  borders: bordersSchema,
  motion: motionSchema,
  components: z.array(componentSchema).describe("Conventions for key components"),
  iconography: iconographySchema,
  layout: layoutSchema,
  voice: voiceSchema,
  content: contentSchema,
  antiPatterns: z.array(z.string()).describe("System-wide anti-patterns to avoid"),
});

export type DesignLanguageSpec = z.infer<typeof designLanguageSpecSchema>;

/** Spec format version, written into design.json for forward-compat. */
export const DESIGN_SPEC_VERSION = 1;
