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
  Code fences and JSON wrappers are syntax errors — the content is saved as a raw .tsx/.css file.`;

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