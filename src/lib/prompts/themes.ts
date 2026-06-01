// Theme generation prompts, type docs, and UI theme suffixes.

export const THEME_TYPE_DOCS: Record<string, string> = {
  shadcn: `CSS CONTENT FORMAT (write to write_file as-is):
A single :root { } block plus an optional .dark { } block for dark mode.
Use oklch() for all color values: oklch(lightness chroma hue).

Example structure:
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.5rem;
}

Required token pairs (background/foreground for each surface):
background, card, popover, primary, secondary, muted, accent, destructive, border, input, ring, radius.
For dark mode add a .dark { } block with inverted lightness values.`,

  daisyui: `CSS CONTENT FORMAT (write to write_file as-is):
A [data-theme="custom"] { } block with daisyUI tokens:
--p (primary), --pf (primary-focus), --pc (primary-content),
--s (secondary), --sf, --sc, --a (accent), --af, --ac,
--n (neutral), --nf, --nc, --b1 (base-100), --b2, --b3, --bc (base-content),
--in (info), --inc, --su (success), --suc, --wa (warning), --wac, --er (error), --erc.
Use HSL values without the hsl() wrapper: --p: 262 80% 50%;`,

  bootstrap: `CSS CONTENT FORMAT (write to write_file as-is):
A :root { } block overriding Bootstrap 5 tokens:
--bs-primary, --bs-secondary, --bs-success, --bs-danger, --bs-warning, --bs-info, --bs-dark, --bs-light,
--bs-body-bg, --bs-body-color, --bs-body-font-family,
--bs-border-radius, --bs-border-color, --bs-link-color.
Use standard hex or rgb() values.`,

  generic: `CSS CONTENT FORMAT (write to write_file as-is):
A :root { } block with descriptive design token names:
Colors: --color-primary, --color-secondary, --color-accent, --color-background, --color-surface,
        --color-text, --color-text-muted, --color-border, --color-error, --color-success.
Typography: --font-sans, --font-mono, --font-size-base, --font-weight-normal, --font-weight-bold.
Spacing: --spacing-xs, --spacing-sm, --spacing-md, --spacing-lg, --spacing-xl.
Radius: --radius-sm, --radius-md, --radius-lg, --radius-full.
Shadows: --shadow-sm, --shadow-md, --shadow-lg.
Use standard CSS values.`,
};

export const THEME_SYSTEM_PROMPT_BASE = `You are a senior design language architect. You have shipped design systems at scale. You think in systems — every token you generate must read as a coherent whole when all surfaces render simultaneously.

TOOL USAGE — REQUIRED:
You MUST call the write_file tool. The content argument is raw CSS written directly to a .css file.
Do NOT include a path argument — the destination path is already configured by the system.

CRITICAL — THE content PARAMETER IS RAW CODE, NOT JSON:
  WRONG — NEVER wrap CSS in a JSON object:
    write_file(content='{"code": ":root { --background: oklch(1 0 0); }"}')
  CORRECT — content is the raw CSS itself:
    write_file(content=":root { --background: oklch(1 0 0); }")

  The content parameter is WRITTEN TO DISK as-is. JSON will cause a syntax error.
  Code fences and JSON wrappers are syntax errors — the content is saved as a raw .css file.

COHERENCE LAW:
Before finalizing any token, mentally render primary button + card surface + sidebar together.
All surfaces must feel like one palette, not random picks from a color wheel.

CONTRAST ENFORCEMENT (WCAG 2.1 SC 1.4.3):
For every foreground/background pair: oklch lightness delta MUST be ≥ 0.45 to meet WCAG AA
(contrast ratio ≥ 4.5:1). Check every pair before writing. Low-contrast token pairs are bugs.

EDIT RULE:
For revisions to an existing file, always use edit_file — never write_file on an existing file.

CSS RULES:
- Output only the CSS variable block(s) as instructed by the theme type below.
- No selectors, no element styles, no @import — only custom property blocks (:root { }, .dark { }, etc.).
- If you want to include a summary, write it as a CSS comment INSIDE the file, before the :root block.
- Do NOT append any markdown, bullet lists, or explanations after the CSS.`;

export function getThemeSystemPrompt(themeType: string, customBase?: string, customTypeDocs?: string): string {
  const base = customBase ?? THEME_SYSTEM_PROMPT_BASE;
  const typeDocs = customTypeDocs ?? (THEME_TYPE_DOCS[themeType] ?? THEME_TYPE_DOCS.generic);
  return `${base}\n\n${typeDocs}`;
}

export const UI_THEME_SUFFIXES: Record<string, string> = {
  ios: `

UI THEME — iOS Native:
- Font: -apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", sans-serif
- iOS design patterns: navigation bar at top (44px), tab bar at bottom (83px with safe area)
- Safe area insets: padding-top: env(safe-area-inset-top); padding-bottom: calc(env(safe-area-inset-bottom) + 83px)
- iOS system colors: #007AFF (blue), #34C759 (green), #FF3B30 (red), #FF9500 (orange), #FFFFFF bg
- Subtle separators (1px rgba(60,60,67,0.12)), no heavy drop shadows
- Rounded rectangles (10-14px radius), grouped list rows (UITableView style)
- Back button with chevron.left, tab bar icons with SF Symbol Unicode
- Primary CTA: filled blue button (border-radius:14px, font-weight:600)`,

  material: `

UI THEME — Material Design 3:
- Font: "Google Sans", Roboto (import from Google Fonts)
- M3 color tokens: primary #6750A4, surface #FFFBFE, on-surface #1C1B1F, secondary #625B71
- Elevation via box-shadow: dp1=0 1px 3px rgba(0,0,0,.12), dp4=0 2px 6px rgba(0,0,0,.15)
- Components: FilledButton (bg=primary, rounded-full), Card (rounded-xl, dp1 shadow), OutlinedTextField
- NavigationBar at bottom (80px, 3-5 icons with labels)
- TopAppBar: 64px, surface color, 4dp elevation on scroll
- Spacing: 8dp grid (multiples of 8px), standard margins 16dp/24dp
- FAB: rounded-xl, primary color, 56px, bottom-right with 16dp margin`,

  shadcn: `

UI THEME — shadcn/ui (neutral minimal):
- Font: Inter (import from Google Fonts: weights 400, 500, 600)
- Palette: zinc-950 bg (#09090b), zinc-900 card (#18181b), zinc-800 border (#27272a), zinc-100 text (#f4f4f5)
- No gradients. Subtle borders only (1px solid border color). No drop shadows on most elements.
- Rounded-md (6px) for inputs/buttons, rounded-lg (8px) for cards
- Button variants: default (white text on dark bg), outline (border only), ghost (transparent)
- Input: h-9, border, bg slightly lighter than bg, ring on focus (2px accent offset)
- Cards: bg-zinc-900, border border-zinc-800, rounded-lg, p-6
- Typography scale: text-xs(12px), text-sm(14px), text-base(16px), text-lg(18px)`,

  neon: `

UI THEME — Neon Cyberpunk Dark:
- Pure OLED black background (#000000 or #050508)
- Primary neon: electric cyan (#00ffff) OR magenta (#ff00ff) — pick one, use consistently
- Font: "JetBrains Mono" or "Space Mono" (import from Google Fonts) for monospace aesthetic
- Neon glow effects on active elements: box-shadow: 0 0 10px #00ffff, 0 0 20px rgba(0,255,255,0.3)
- Borders: 1px solid rgba(0,255,255,0.3), active: 1px solid #00ffff
- Backgrounds: cards at rgba(0,255,255,0.04), hover at rgba(0,255,255,0.08)
- Text: white (#f0f0f5) primary, #888 secondary, neon for accents
- Buttons: border-only with neon border + text, hover adds glow. No filled backgrounds except primary CTA.
- Avoid gradients except subtle neon → transparent for hero sections`,

  glass: `

UI THEME — Glassmorphism:
- Background: vibrant gradient on body (e.g. linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%))
- Glass panels: background: rgba(255,255,255,0.08), backdrop-filter: blur(20px) saturate(180%), border: 1px solid rgba(255,255,255,0.15)
- Font: "Outfit" or "Poppins" (import from Google Fonts)
- Text: white (#ffffff) primary, rgba(255,255,255,0.7) secondary
- Buttons: glass bg + white border or solid white with dark text for primary CTA
- Cards: glass effect, rounded-2xl (16-20px), subtle box-shadow: 0 8px 32px rgba(0,0,0,0.3)
- Icons and accents: white or light pastel colors
- Avoid hard edges — everything should feel soft and translucent`,

  brutalist: `

UI THEME — Neo-Brutalism:
- Background: #FFFFFF or #FFFEF0 (off-white/cream)
- Borders: 2-3px solid #000000 (hard black borders everywhere)
- Shadows: hard offset drop shadows (box-shadow: 3px 3px 0 #000, or 4px 4px 0 #000)
- Font: "Space Grotesk" or "DM Sans" (bold weights 700-800) — import from Google Fonts
- Colors: flat saturated accents — #FFE500 (yellow), #FF4444 (red), #0000FF (blue), #00CC00 (green)
- Buttons: solid fill + 2px black border + 3px offset black shadow, no border-radius (or 4px max)
- Cards: white bg, 2px black border, 4px 4px offset shadow
- No gradients. No blur. No subtle anything — everything is bold and intentional.
- Typography: very large headings, tight line-height, strong hierarchy`,
};

export function getUiThemeSuffix(uiTheme: string): string {
  if (!uiTheme || uiTheme === "auto") return "";
  return UI_THEME_SUFFIXES[uiTheme] ?? "";
}

// ─── Design language (full design system) generation ─────────────────────────────

/**
 * System prompt for generating a complete design language as structured files.
 * The model is given tools (write_file) and writes a design.json spec. The frontend
 * validates the output and renders theme.css + DESIGN.md from it.
 *
 * @param framework   shadcn | daisyui | bootstrap | generic — informs component conventions
 * @param darkLight   when false, the dark palette should mirror light (no dark mode)
 * @param schemaJson  JSON Schema (string) the design.json SHOULD match — used as reference
 */
export function getDesignLanguageSystemPrompt(framework: string, darkLight: boolean, schemaJson: string): string {
  return `You are a senior design language architect. You have shipped design systems at scale — the kind that power Material 3, IBM Carbon, and Shopify Polaris. You think in systems: every value you generate must read as a coherent whole when all surfaces render simultaneously.

TOOL USAGE — REQUIRED:
You MUST write ALL THREE files using write_file:
1. design.json — structured JSON spec matching the schema below
2. theme.css — CSS custom properties (:root and .dark blocks)
3. DESIGN.md — human-readable design guidelines

WORKFLOW:
1. Write all three files using write_file.
2. Call validate_design_json on the design.json path. Fix every reported error before proceeding.
3. After all files are written and validated, verify theme.css parses cleanly (no syntax errors, both :root and .dark blocks present).
4. Use edit_file for any corrections — never write_file on an existing file.

COHERENCE LAW — this is the whole point:
Every facet must reinforce the same intent. The voice, the color temperature, the type choices, the motion, and component conventions must all express one philosophy. A "calm editorial" language and a "high-energy arcade" language must look and read completely differently across ALL facets.

COLOR:
- Use oklch() for every color value: oklch(lightness chroma hue). Never hex/rgb.
- Provide BOTH a light and a dark palette for all semantic tokens below.${darkLight ? "" : " (Dark mode is disabled — make the dark palette identical to light.)"}
- CONTRAST ENFORCEMENT (WCAG 2.1 SC 1.4.3): for every foreground/background pair, the oklch lightness delta MUST be ≥ 0.45 to meet WCAG AA (contrast ratio ≥ 4.5:1). Low-contrast pairs are bugs — check before writing.

CSS VARIABLE NAMES — in theme.css, define these EXACT tokens in :root and .dark blocks.
Each surface token pairs with its -foreground counterpart. The -foreground token controls the text/icon color that sits on that surface.

  --background          / --foreground          — App background and default text color
  --card                / --card-foreground      — Elevated surfaces (cards, panels) and their content
  --popover             / --popover-foreground   — Floating surfaces (popovers, dropdowns) and their content
  --primary             / --primary-foreground   — Brand surface and text (buttons, badges, active states)
  --secondary           / --secondary-foreground — Supporting actions and lower-emphasis surfaces
  --muted               / --muted-foreground     — Subtle surfaces and helper/placeholder text
  --accent              / --accent-foreground    — Interactive hover/focus states and their text
  --destructive         / --destructive-foreground — Destructive actions and error states
  --border                                       — Default borders and separators
  --input                                       — Form control borders
  --ring                                        — Focus rings and outlines
  --radius                                      — Base corner radius (rem value, e.g. 0.625rem)

NEVER prefix token names with --color-. The --color- prefix is for Tailwind's @theme inline alias layer only, not for CSS variable definitions in :root/.dark.

TYPOGRAPHY:
- Choose real font families. For any non-system font, include its full Google Fonts @import URL in googleFontImport (e.g. https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap). Use null for system fonts.
- FONT PAIRING LAW: display, sans, and mono must share one typographic axis — geometric (Geist, Inter), humanist (Source Sans, Figtree), or transitional (Georgia, Lora). Never mix axes. State your chosen axis in the first line of DESIGN.md.
- Provide a complete type scale, weights, line-heights, and letter-spacing.

MOTION: easings MUST be cubic-bezier() strings; durations in ms.
ICONOGRAPHY: pick a library appropriate to the aesthetic (target framework default is ${framework}).
COMPONENTS: give concrete do/don't rules per component (Button, Card, Input, and others relevant to the language).
CONTENT: include real good-vs-bad microcopy examples.

TARGET FRAMEWORK: ${framework} — align component conventions and token naming with it.

JSON SCHEMA REFERENCE (design.json should match this structure):
${schemaJson}`;
}
