// Shared types, constants, and helper sections used by all prompt modules.

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

// ─── Design tokens ────────────────────────────────────────────────────────────

/**
 * Parse CSS custom property names from a theme's :root {} block.
 * Returns the list of --token-name strings found, ignoring values.
 */
export function extractDesignTokenNames(themeCss: string): string[] {
  const names: string[] = [];
  const rootMatch = themeCss.match(/:root\s*\{([^}]*)\}/s);
  if (!rootMatch) return names;
  const declarations = rootMatch[1].matchAll(/--[\w-]+(?=\s*:)/g);
  for (const match of declarations) {
    names.push(match[0]);
  }
  return names;
}

/**
 * Build the design tokens prompt section from parsed token names.
 * Returns empty string when no tokens are available.
 */
export function getDesignTokensSection(tokenNames: string[]): string {
  if (tokenNames.length === 0) return "";
  return `\n\nDESIGN TOKENS — use these CSS custom properties for all colors, spacing, and radii. Never hardcode hex/rgb values:
${tokenNames.map((t) => `  ${t}`).join("\n")}
Usage: className="bg-[var(--primary)] text-[var(--primary-foreground)]" or style={{color: "var(--foreground)"}}}`;
}

// ─── Mock data layer ──────────────────────────────────────────────────────────

export const DATA_LAYER_SECTION = `
SHARED MOCK DATA — available at @/data/store:
- Import realistic data instead of hardcoding dummy text: import { users, products } from '@/data/store';
- Use glob("data/*.ts") to discover what data files already exist before creating new ones.
- If the data you need doesn't exist yet, create a new file (e.g. data/users.ts) and add an export to data/store.ts.
- Data files use plain TypeScript — typed arrays of objects with realistic values (real names, prices, dates, etc).`;

// ─── Shared tool-calling section (DRY — used by screen and component prompts) ──

export const TOOL_USAGE_SECTION = `TOOL USAGE — REQUIRED:
You MUST call the write_file tool. The content argument is the raw source code written directly to a file.

CRITICAL — THE content PARAMETER IS RAW CODE, NOT JSON:
  WRONG — NEVER wrap code in a JSON object:
    write_file(content='{"commentary":"I built...", "title":"...", "code":"function App()..."}')
    write_file(content='{"code": "function App() { ... }"}')

  CORRECT — content is the raw code itself:
    write_file(content="function App() { return <div>Hello</div>; }")

  The content parameter is WRITTEN TO DISK as-is. JSON will cause a syntax error.
  Code fences and JSON wrappers are syntax errors — the content is saved as a raw .tsx/.css file.

VALIDATION — After writing or editing code:
1. Call run_tsc (optionally with the file path to filter output) to check for TypeScript errors.
2. Call run_lint with the file path to check for ESLint violations.
3. Call run_build with the file path to catch JSX/Babel syntax errors that tsc does not detect (e.g. malformed JSX tags).
If errors are found, use edit_file to fix them surgically — do NOT rewrite the whole file with write_file.

IMPORTANT WORKFLOW:
When asked to UPDATE an existing file, you MUST first read_file to see the current code,
then use edit_file to make targeted changes. Only use write_file when creating a brand-new file.`;

export function outputFilePathSection(outputPath: string): string {
  // Derive the project root from the output path (e.g. "projects/my-app/screens/x/screen.tsx" → "projects/my-app")
  const parts = outputPath.split("/");
  const projectRoot = parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  return `

OUTPUT FILE — Your write_file output is saved to: ${outputPath}
When using read_file to verify or fix your code, use exactly this path: ${outputPath}

PATH CONVENTIONS — all file paths are relative to the app data root:
- Project root: ${projectRoot}/
- glob and grep return paths relative to the PROJECT ROOT (e.g. "screens/x/screen.tsx")
- read_file, write_file, and edit_file require paths from the APP DATA ROOT (e.g. "${projectRoot}/screens/x/screen.tsx")
- When using a path from glob/grep with read_file: prepend "${projectRoot}/" to it.`;
}

// ─── Shadcn component catalog (used by shadcn-mode prompts) ──────────────────

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

// ─── Design Brief templates (opendesigner.io style) ──────────────────────────

export interface DesignBriefTemplate {
  name: string;
  description: string;
  palette: string[];
  content: string;
}

export const DESIGN_BRIEF_TEMPLATES: DesignBriefTemplate[] = [
  {
    name: "Minimal / Clean",
    description: "Lots of whitespace, Inter font, neutral palette, subtle borders",
    palette: ["#ffffff", "#f5f5f5", "#e5e5e5", "#a3a3a3", "#171717"],
    content: `# Minimal / Clean\nA calm, focused design that values whitespace and legibility above all.\n\nCOLOR\n- Background: pure white (#ffffff) or near-white (#fafafa)\n- Text: dark gray (#171717), light gray (#737373) for secondary\n- Accents: single muted accent (slate blue #64748b or warm gray)\n- Borders: 1px solid #e5e5e5\n\nTYPOGRAPHY\n- Font: Inter, system-ui fallback\n- Scale: 12px caption, 14px body, 16px base, 20px h3, 24px h2, 32px h1\n- Line height: 1.6 for body, 1.2 for headings\n- Weight: 400 regular, 500 medium, 600 semibold — no bold\n\nSPACING\n- Base unit: 4px. Use multiples: 8, 12, 16, 24, 32, 48, 64\n- Generous padding in cards and sections\n\nCOMPONENTS\n- Cards: white bg, 1px #e5e5e5 border, 8px radius, no shadow\n- Buttons: outline style preferred, filled only for primary CTA\n- Inputs: thin 1px border, no heavy outlines\n\nANTI-PATTERNS\n- No drop shadows except very subtle (0 1px 3px rgba(0,0,0,.08))\n- No gradient backgrounds\n- No decorative icons or illustrations`,
  },
  {
    name: "Neo-Brutalism",
    description: "Thick black borders, flat colors, strong contrast, monospace font",
    palette: ["#ffffff", "#ffde59", "#ff5757", "#5ce1e6", "#000000"],
    content: `# Neo-Brutalism\nRaw, honest, unapologetic design. Heavily inspired by 90s web and print brutalism.\n\nCOLOR\n- Background: white (#ffffff) or off-white (#f5f0e8)\n- Key accent: bright yellow (#ffde59), coral red (#ff5757), or cyan (#5ce1e6) — pick ONE\n- All borders: pure black (#000000)\n- Text: pure black (#000000) on light, white (#ffffff) on dark\n\nTYPOGRAPHY\n- Font: Space Grotesk, Syne, or system monospace (Courier New fallback)\n- Scale: oversized headings (48–96px), normal body (15–16px)\n- Weight: 700–900 for headings, 400–500 for body\n- Letter-spacing: -0.02em to -0.04em for headings\n\nCOMPONENTS\n- Cards: white bg, 3–4px solid black border, 0 radius, translate on hover\n- Buttons: solid black bg + white text OR accent fill + black text, 3px border, 0 radius\n- Shadows: always offset, opaque black: "4px 4px 0px #000" or "6px 6px 0px #000"\n- Inputs: 2px solid black, 0 radius\n\nANTI-PATTERNS\n- No rounded corners (never more than 2px)\n- No gradients\n- No thin or decorative fonts\n- No subtle/muted colors — everything high contrast`,
  },
  {
    name: "Glass Morphism",
    description: "Frosted glass, blur effects, dark backgrounds, vibrant gradients",
    palette: ["#0f0f1a", "#ffffff30", "#a78bfa", "#60a5fa", "#f0abfc"],
    content: `# Glass Morphism\nTranslucent surfaces layered over rich dark gradients. Premium, futuristic, immersive.\n\nCOLOR\n- Background: deep dark (#0a0a1a or #0f0f23), layered gradient from purple to dark blue\n- Surface: rgba(255,255,255,0.08) to rgba(255,255,255,0.15) with backdrop-filter: blur(20px)\n- Border: rgba(255,255,255,0.15) — always subtle\n- Text: white (#ffffff) primary, rgba(255,255,255,0.7) secondary\n- Accents: violet (#a78bfa), sky blue (#60a5fa), pink (#f0abfc)\n\nTYPOGRAPHY\n- Font: Inter, Plus Jakarta Sans, or Geist\n- Weight: 300–400 for body, 600–700 for headings\n- Hierarchy through opacity not weight\n\nCOMPONENTS\n- Cards: backdrop-blur + rgba bg + thin rgba border + subtle inset glow\n- Buttons: glass primary or gradient fill (purple → blue)\n- CSS: backdrop-filter: blur(20px) saturate(180%); background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.15); box-shadow: 0 8px 32px rgba(0,0,0,0.3)\n\nANTI-PATTERNS\n- No opaque solid backgrounds\n- No harsh borders or thick outlines\n- No light-mode color palette`,
  },
  {
    name: "Neon / HUD",
    description: "Dark theme, green/cyan neon accents, monospace font, data-dense layouts",
    palette: ["#050505", "#0d1117", "#00ff88", "#00cfff", "#ff0055"],
    content: `# Neon / HUD\nTerminal meets sci-fi dashboard. Dense data, glowing UI, machine aesthetic.\n\nCOLOR\n- Background: near-black (#050505 or #0d1117)\n- Primary neon: electric green (#00ff88) or cyan (#00cfff) — pick ONE\n- Alert: hot pink (#ff0055)\n- Text: neon color for active, 50% opacity for secondary\n- Grid lines: rgba(0,255,136,0.15)\n\nTYPOGRAPHY\n- Font: JetBrains Mono, Fira Code, Space Mono — monospace exclusively\n- Scale: dense — 11px labels, 13px body, 15px values, 20px headings\n- Uppercase with letter-spacing for labels\n- Numbers in tabular-nums variant\n\nCOMPONENTS\n- Cards: dark bg, 1px neon border (0.3 opacity), glow on hover\n- Buttons: neon outline only, text-glow on hover (box-shadow: 0 0 10px rgba(0,255,136,0.3))\n- Inputs: dark bg, neon bottom-border only\n- text-shadow: 0 0 8px currentColor for headings\n\nANTI-PATTERNS\n- No rounded corners (max 2px)\n- No gradients, no light backgrounds, no sans-serif fonts`,
  },
];

// ─── Generation context sections (appended to system prompts) ─────────────────

/** Formats a DESIGN.md brief for injection into screen/component generation prompts. */
export function buildDesignBriefSection(brief: string): string {
  if (!brief.trim()) return "";
  return `\n\nDESIGN BRIEF — follow these design system instructions precisely. Override any conflicting defaults:\n\n${brief.trim()}`;
}

/** Formats selected API definitions for injection into screen/component generation prompts. */
export function buildApiContextSection(
  apis: Array<{ name: string; method: string; url: string; proxyPath?: string }>,
  _keyNames: string[] = [] // eslint-disable-line @typescript-eslint/no-unused-vars -- kept for API compat; key names are now auto-derived from URL {{PLACEHOLDER}} patterns
): string {
  if (apis.length === 0) return "";
  const lines = apis.map((api) => {
    const base = api.proxyPath?.trim() || api.url;
    const keyMatch = api.url.match(/\{\{(\w+)\}\}/);
    const authNote = keyMatch ? `\n    Auth env var: import.meta.env.VITE_${keyMatch[1]}` : "";
    return `  ${api.method} ${base}  (${api.name})${authNote}`;
  });
  return [
    "\n\nAVAILABLE APIS — use @tanstack/react-query for all data fetching:",
    ...lines,
    "",
    "Import: import { useQuery } from '@tanstack/react-query'",
    "Use proxy paths as base URLs (e.g. /api/weather, not https://api.openweathermap.org) — CORS-free in dev.",
    "Always add loading and error states. Import service hooks from '@/services/{name}' if available.",
    "For TanStack Query: wrap the tree with <QueryClientProvider> in main.tsx (already done by scaffold).",
  ].join("\n");
}

/** Injects selected component source code so AI can reuse them in the generated screen. */
export function buildComponentsSection(
  components: Array<{ name: string; code: string }>
): string {
  if (components.length === 0) return "";
  const blocks = components.map(
    (c) => `### ${c.name}\n\`\`\`tsx\n${c.code.slice(0, 3000)}\n\`\`\``
  );
  return [
    "\n\nAVAILABLE COMPONENTS — reuse these in your output, do NOT recreate them:",
    ...blocks,
    "",
    "Import them from '@/components/{component-id}/component' (replace {component-id} with the actual dir name).",
  ].join("\n");
}