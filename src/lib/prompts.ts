// Shared system prompts adapted from ai-ui-generator
// https://github.com/ai-ui-generator

export type IconLibrary = "lucide" | "tabler" | "fontawesome" | "bootstrap" | "material" | "none";

export const ICON_LIBRARY_PACKAGES: Record<IconLibrary, string> = {
  lucide: "lucide-react",
  tabler: "@tabler/icons-webfont",
  fontawesome: "@fortawesome/fontawesome-free",
  bootstrap: "bootstrap-icons",
  material: "@material-symbols/font-400",
  none: "",
};

export const ICON_LIBRARY_CSS_PATHS: Record<IconLibrary, string> = {
  lucide: "",
  tabler: "dist/tabler-icons.min.css",
  fontawesome: "css/all.min.css",
  bootstrap: "font/bootstrap-icons.css",
  material: "material-symbols-outlined.css",
  none: "",
};

export function getIconLibraryPromptSection(iconLibrary: IconLibrary): string {
  switch (iconLibrary) {
    case "lucide":
      return `ICON LIBRARY — lucide-react:
- Import icons from "lucide-react": import { Home, User, Settings, Search, Mail, Lock, Star, Bell, Menu, X, Check, Plus, Trash2, Pencil, ArrowLeft, ChevronRight } from "lucide-react";
- Use as React components: <Home size={20} /> or <Bell className="w-5 h-5" />
- Available icons include all Lucide icons (https://lucide.dev/icons/)`;
    case "tabler":
      return `ICON LIBRARY — Tabler Icons (CSS icon font):
- Use <i> tags with ti- classes: <i className="ti ti-home"></i>
- Common icons: ti-home, ti-user, ti-settings, ti-search, ti-mail, ti-lock, ti-star, ti-bell, ti-menu, ti-x, ti-check, ti-plus, ti-trash, ti-edit, ti-arrow-left, ti-chevron-right
- The CSS font is already loaded — no imports needed`;
    case "fontawesome":
      return `ICON LIBRARY — Font Awesome (CSS icon font):
- Use <i> tags with fa- classes: <i className="fa-solid fa-home"></i>
- Common icons: fa-house, fa-user, fa-gear, fa-magnifying-glass, fa-bell, fa-star, fa-trash, fa-pen, fa-plus, fa-arrow-left, fa-chevron-right
- The CSS font is already loaded — no imports needed`;
    case "bootstrap":
      return `ICON LIBRARY — Bootstrap Icons (CSS icon font):
- Use <i> tags with bi- classes: <i className="bi bi-house"></i>
- Common icons: bi-house, bi-person, bi-gear, bi-search, bi-bell, bi-star, bi-trash, bi-pencil, bi-plus, bi-arrow-left, bi-chevron-right
- The CSS font is already loaded — no imports needed`;
    case "material":
      return `ICON LIBRARY — Material Symbols (CSS icon font):
- Use <span> tags with material-symbols-outlined class: <span className="material-symbols-outlined">home</span>
- Common icons: home, search, settings, person, notifications, star, delete, edit, add, arrow_back, menu, close, check
- The CSS font is already loaded — no imports needed`;
    case "none":
      return `ICON LIBRARY — None:
- Do not use any icon library. Use text labels, emoji, or simple shapes instead.`;
    default:
      return "";
  }
}

export const SHADCN_COMPONENT_CATALOG = `AVAILABLE SHADCN/UI COMPONENTS — import from "@/components/ui/{name}":
- avatar: Avatar, AvatarImage, AvatarFallback — user profile images
- badge: Badge, badgeVariants — status indicators, tags
- button: Button, buttonVariants — primary actions (variants: default, destructive, outline, secondary, ghost, link; sizes: default, sm, lg, icon)
- card: Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter — content containers
- checkbox: Checkbox — boolean input
- collapsible: Collapsible, CollapsibleTrigger, CollapsibleContent — expand/collapse sections
- context-menu: ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuCheckboxItem, ContextMenuRadioItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut — right-click menus
- dialog: Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose — modal overlays
- dropdown-menu: DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioItem, DropdownMenuLabel, DropdownMenuSeparator — dropdown selections
- input: Input — text input fields
- label: Label — form field labels
- scroll-area: ScrollArea, ScrollBar — scrollable containers
- select: Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel — dropdown selects
- separator: Separator — visual dividers
- steps: Steps — step indicators
- tabs: Tabs, TabsList, TabsTrigger, TabsContent — tabbed navigation
- textarea: Textarea — multi-line text input
- tooltip: Tooltip, TooltipTrigger, TooltipContent, TooltipProvider — hover info

UTILITY:
- import { cn } from "@/lib/utils" — combines clsx + tailwind-merge for conditional classes`;

// ─── Shared tool-calling section (DRY — used by all prompt bases) ──────────

const TOOL_USAGE_SECTION = `TOOL USAGE — REQUIRED:
You MUST call the write_file tool. The content argument is the raw source code written directly to a file.

CRITICAL — THE content PARAMETER IS RAW CODE, NOT JSON:
  WRONG — NEVER wrap code in a JSON object:
    write_file(content='{"commentary":"I built...", "title":"...", "code":"function App()..."}')
    write_file(content='{"code": "function App() { ... }"}')

  CORRECT — content is the raw code itself:
    write_file(content="function App() { return <div>Hello</div>; }")

  The content parameter is WRITTEN TO DISK as-is. JSON will cause a syntax error.
  Code fences and JSON wrappers are syntax errors — the content is saved as a raw .tsx/.css file.`;

// ─── Screen Prompts ────────────────────────────────────────────────────────

export const SCREEN_NEW_PROMPT_BASE = `You are an expert React/TypeScript developer. Generate a complete, production-quality UI screen.

${TOOL_USAGE_SECTION}

GLOBALS — DO NOT IMPORT ANY OF THESE, they are pre-loaded:
- React and all hooks: useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext
- Lucide icons: any icon from lucide-react (Home, User, Settings, Search, Mail, Bell, Star, Menu, X, Check, Plus, Trash2, Edit, ChevronRight, ArrowLeft, etc.) — use them directly, e.g. <Bell size={20} />

CODE RULES:
- NO import statements of any kind — they will break the runtime.
- NO export keyword — just: function App() { ... }
- TypeScript types for all props and state. Never use \`any\`.
- DESIGN FOR ALL SCREEN SIZES — responsive at 375px, 768px, and 1280px.
- Mobile-first Tailwind: use sm:, md:, lg: prefixes for layout changes.
- Style with Tailwind classes and CSS variables. Available variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies correctly.
- Generate realistic content — real names, real data, no "Lorem ipsum".
- Do NOT wrap in HTML, DOCTYPE, html, head, or body tags.`;

export function getScreenNewPrompt(iconLibrary: IconLibrary, customBase?: string): string {
  return `${customBase ?? SCREEN_NEW_PROMPT_BASE}\n\n${getIconLibraryPromptSection(iconLibrary)}`;
}

export const COMPONENT_NEW_PROMPT_BASE = `You are an expert React/TypeScript developer generating focused, reusable UI components.

This is a COMPONENT preview — NOT a full-page app generator. The preview area is max 400px wide.

${TOOL_USAGE_SECTION}

GLOBALS — DO NOT IMPORT ANY OF THESE, they are pre-loaded:
- React and all hooks: useState, useEffect, useRef, useMemo, useCallback, useReducer, useContext, createContext
- Lucide icons: any icon from lucide-react (Home, User, Settings, Search, Mail, Bell, Star, Menu, X, Check, Plus, Trash2, Edit, ChevronRight, ArrowLeft, etc.) — use directly, e.g. <Bell size={20} />

CODE RULES:
- NO import statements of any kind — they will break the runtime.
- NO export keyword — just: function App() { ... }
- TypeScript types for all props and state. Never use \`any\`. For icon props: React.ComponentType<{ size?: number; className?: string }>
- Style with Tailwind classes and CSS variables. Available variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your component inherits it automatically.
- Keep it compact — the component must fit within 400px width.

GENERATE ONE FOCUSED COMPONENT (not a full-page layout):
- Button, badge, chip, toggle, switch, input field
- Card (product, profile, stat, feature)
- List item, menu item, navigation item, tab
- Small form (login, search, contact)
- Header section, sidebar section, modal content

DO NOT generate full pages, dashboards, multi-section layouts, or full-screen apps.`;

export const COMPONENT_NEW_PROMPT_SHADCN = `You are an expert React/TypeScript developer generating focused, reusable UI components using shadcn/ui.

This is a COMPONENT preview — NOT a full-page app generator. The preview area is max 400px wide.

${SHADCN_COMPONENT_CATALOG}

${TOOL_USAGE_SECTION}

CODE RULES:
- You MAY import shadcn components: import { Button } from "@/components/ui/button"
- You MAY import cn utility: import { cn } from "@/lib/utils"
- Do NOT import React or React hooks — they are available globally.
- The function MUST be named \`App\` and be the default export: export default function App() { ... }
- TypeScript types for all props and state. Never use \`any\`.
- Style with Tailwind classes and CSS variables. Available variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your component inherits it automatically.
- Prefer shadcn components over raw HTML elements. Use <Button> not <button>, <Card> not a <div> with card styles, etc.
- Keep it compact — the component must fit within 400px width.

GENERATE ONE FOCUSED COMPONENT (not a full-page layout):
- Button, badge, chip, toggle, switch, input field
- Card (product, profile, stat, feature)
- List item, menu item, navigation item, tab
- Small form (login, search, contact)
- Header section, sidebar section, modal content

DO NOT generate full pages, dashboards, multi-section layouts, or full-screen apps.`;

export function getComponentNewPrompt(iconLibrary: IconLibrary, shadcnMode?: boolean, customBase?: string): string {
  const base = customBase ?? (shadcnMode ? COMPONENT_NEW_PROMPT_SHADCN : COMPONENT_NEW_PROMPT_BASE);
  return `${base}\n\n${getIconLibraryPromptSection(iconLibrary)}`;
}

export const COMPONENT_UPDATE_PROMPT_BASE = `You are an expert React/TypeScript developer updating a focused UI component.

This is a COMPONENT preview — NOT a full-page app generator. Keep the component small and focused.

${TOOL_USAGE_SECTION}

CODE RULES:
- Output the COMPLETE updated function — do NOT patch or diff.
- NO import statements of any kind. NO export keyword. Function must be named App.
- Preserve the component scope — do NOT expand into a full-screen layout.
- Keep all existing hooks, state, and handlers intact.
- Apply ONLY the requested changes.
- TypeScript types throughout. Never use \`any\`.
- Use CSS variables for colors (var(--primary), var(--accent), etc.) — not hardcoded hex.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your component inherits it automatically.`;

export const COMPONENT_UPDATE_PROMPT_SHADCN = `You are an expert React/TypeScript developer updating a focused UI component using shadcn/ui.

This is a COMPONENT preview — NOT a full-page app generator. Keep the component small and focused.

${SHADCN_COMPONENT_CATALOG}

${TOOL_USAGE_SECTION}

CODE RULES:
- Output the COMPLETE updated function — do NOT patch or diff.
- You MAY import shadcn components: import { Button } from "@/components/ui/button"
- You MAY import cn utility: import { cn } from "@/lib/utils"
- Do NOT import React or React hooks — they are available globally.
- Preserve the component scope — do NOT expand into a full-screen layout.
- Keep all existing hooks, state, and handlers intact.
- Apply ONLY the requested changes.
- Preserve any existing shadcn imports — do not remove them.
- TypeScript types throughout. Never use \`any\`.
- Use CSS variables for colors (var(--primary), var(--accent), etc.) — not hardcoded hex.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your component inherits it automatically.`;

export function getComponentUpdatePrompt(iconLibrary: IconLibrary, currentCode?: string, shadcnMode?: boolean, customBase?: string): string {
  const base = customBase ?? (shadcnMode ? COMPONENT_UPDATE_PROMPT_SHADCN : COMPONENT_UPDATE_PROMPT_BASE);
  const codeSection = currentCode
    ? `\n\nCURRENT CODE — edit this code to apply the user's requested changes:\n\`\`\`tsx\n${currentCode}\n\`\`\``
    : "";
  return `${base}\n\n${getIconLibraryPromptSection(iconLibrary)}${codeSection}`;
}

export const SCREEN_UPDATE_PROMPT_BASE = `You are an expert React/TypeScript developer making surgical edits to a TSX screen.

${TOOL_USAGE_SECTION}

CODE RULES:
- Output the COMPLETE updated function — do NOT patch or diff.
- NO import statements. NO export keyword. Function must be named App.
- Preserve ALL existing functionality and responsive design unless asked to change it.
- Keep all existing hooks, state, and handlers intact.
- Apply ONLY the requested changes.
- TypeScript types throughout. Never use \`any\`.
- Use CSS variables for colors, not hardcoded hex/rgb values.`;

export function getScreenUpdatePrompt(iconLibrary: IconLibrary, currentCode?: string, customBase?: string): string {
  const codeSection = currentCode
    ? `\n\nCURRENT CODE — edit this code to apply the user's requested changes:\n\`\`\`tsx\n${currentCode}\n\`\`\``
    : "";
  return `${customBase ?? SCREEN_UPDATE_PROMPT_BASE}\n\n${getIconLibraryPromptSection(iconLibrary)}${codeSection}`;
}

// ─── Theme Generator Prompts ─────────────────────────────────────────────────

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

export const THEME_SYSTEM_PROMPT_BASE = `You are a CSS design token expert. 
Generate a complete, production-ready theme as CSS custom properties.

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

CSS RULES:
- Output only the CSS variable block(s) as instructed by the theme type below.
- No selectors, no element styles, no @import — only custom property blocks (:root { }, .dark { }, etc.).
- Every token must work together as a cohesive theme.
- If you want to include a summary, write it as a CSS comment INSIDE the file, before the :root block.
  Example: /* Halloween theme — pumpkin orange primary, deep violet secondary */
- Do NOT append any markdown, bullet lists, or explanations after the CSS.`;

export function getThemeSystemPrompt(themeType: string, customBase?: string, customTypeDocs?: string): string {
  const base = customBase ?? THEME_SYSTEM_PROMPT_BASE;
  const typeDocs = customTypeDocs ?? (THEME_TYPE_DOCS[themeType] ?? THEME_TYPE_DOCS.generic);
  return `${base}\n\n${typeDocs}`;
}

// ─── Prompt definitions — used by SettingsModal to render editable prompt slots ─

export type PromptGroup = "Components" | "Screens" | "Themes";

export interface PromptDefinition {
  key: string;
  label: string;
  group: PromptGroup;
  description: string;
  getDefault: () => string;
}

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  {
    key: "prompt.components.new",
    label: "New Component — base",
    group: "Components",
    description: "System prompt base for generating a brand-new component. The icon library section and theme CSS are appended automatically.",
    getDefault: () => COMPONENT_NEW_PROMPT_BASE,
  },
  {
    key: "prompt.components.update",
    label: "Update Component — base",
    group: "Components",
    description: "System prompt base for editing an existing component. The icon library section and current code block are appended automatically.",
    getDefault: () => COMPONENT_UPDATE_PROMPT_BASE,
  },
  {
    key: "prompt.components.new.shadcn",
    label: "New Component — shadcn base",
    group: "Components",
    description: "System prompt base for generating a new component with shadcn/ui support. Used when shadcnMode is enabled.",
    getDefault: () => COMPONENT_NEW_PROMPT_SHADCN,
  },
  {
    key: "prompt.components.update.shadcn",
    label: "Update Component — shadcn base",
    group: "Components",
    description: "System prompt base for editing an existing component with shadcn/ui support. Used when shadcnMode is enabled.",
    getDefault: () => COMPONENT_UPDATE_PROMPT_SHADCN,
  },
  {
    key: "prompt.screens.new",
    label: "New Screen — base",
    group: "Screens",
    description: "System prompt base for generating a brand-new screen. The icon library section and theme CSS are appended automatically.",
    getDefault: () => SCREEN_NEW_PROMPT_BASE,
  },
  {
    key: "prompt.screens.update",
    label: "Update Screen — base",
    group: "Screens",
    description: "System prompt base for editing an existing screen. The icon library section and current code block are appended automatically.",
    getDefault: () => SCREEN_UPDATE_PROMPT_BASE,
  },
  {
    key: "prompt.themes.base",
    label: "Theme Generator — base",
    group: "Themes",
    description: "System prompt base shared by all theme framework types. The framework-specific token docs are appended automatically.",
    getDefault: () => THEME_SYSTEM_PROMPT_BASE,
  },
  {
    key: "prompt.themes.shadcn",
    label: "Theme Format — shadcn",
    group: "Themes",
    description: "Token format docs appended when the shadcn framework is selected.",
    getDefault: () => THEME_TYPE_DOCS.shadcn,
  },
  {
    key: "prompt.themes.daisyui",
    label: "Theme Format — daisyUI",
    group: "Themes",
    description: "Token format docs appended when the daisyUI framework is selected.",
    getDefault: () => THEME_TYPE_DOCS.daisyui,
  },
  {
    key: "prompt.themes.bootstrap",
    label: "Theme Format — Bootstrap",
    group: "Themes",
    description: "Token format docs appended when the Bootstrap framework is selected.",
    getDefault: () => THEME_TYPE_DOCS.bootstrap,
  },
  {
    key: "prompt.themes.generic",
    label: "Theme Format — Generic",
    group: "Themes",
    description: "Token format docs appended when the Generic framework is selected.",
    getDefault: () => THEME_TYPE_DOCS.generic,
  },
];

// ─── UI Theme Suffixes (optional visual styles) ─────────────────────────────

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
