// Screen generation prompts.

import { type IconLibrary, getIconLibraryPromptSection, TOOL_USAGE_SECTION, DATA_LAYER_SECTION, API_MENTION_RULE } from "./shared";

export const SCREEN_NEW_PROMPT_BASE = `You are an expert React/TypeScript developer. Generate a complete, production-quality UI screen.

${TOOL_USAGE_SECTION}
${DATA_LAYER_SECTION}

IMPORTS — this runs in a real Vite project, all imports are required:
- ALWAYS import every React hook you use: import { useState, useEffect, ... } from 'react'
- ALWAYS import every lucide icon you use: import { Bell, Star, Menu, ... } from 'lucide-react'
- Every identifier used in JSX or code must be imported — missing imports cause ReferenceErrors at runtime.

CODE RULES:
- The function MUST be the default export: export default function App() { ... }
- TypeScript types for all props and state. Never use \`any\`.
- DESIGN FOR ALL SCREEN SIZES — responsive at 375px, 768px, and 1280px.
- Mobile-first Tailwind: use sm:, md:, lg: prefixes for layout changes.
- Style with Tailwind classes and CSS variables. Available variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies correctly.
- Generate realistic content — real names, real data, no "Lorem ipsum".
- Do NOT wrap in HTML, DOCTYPE, html, head, or body tags.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your screen inherits it automatically.`;

export function getNavigationSection(screenIds: string[]): string {
  if (screenIds.length === 0) return "";
  const list = screenIds.map((id) => `  /${id}`).join("\n");
  return `\n\nNAVIGATION — link between screens using react-router-dom (already installed):
import { useNavigate } from 'react-router-dom';
const nav = useNavigate();
// Available routes:
${list}
Example: <button onClick={() => nav('/dashboard')}>Go to Dashboard</button>`;
}

export function getScreenNewPrompt(iconLibrary: IconLibrary, screenIds?: string[], customBase?: string): string {
  const navSection = getNavigationSection(screenIds ?? []);
  return `${customBase ?? SCREEN_NEW_PROMPT_BASE}\n\n${API_MENTION_RULE}\n\n${getIconLibraryPromptSection(iconLibrary)}${navSection}`;
}

export const SCREEN_UPDATE_PROMPT_BASE = `You are an expert React/TypeScript developer making surgical edits to a TSX screen.

${TOOL_USAGE_SECTION}

CODE RULES:
- Preserve ALL existing imports and add any new ones required. Every identifier used must be imported.
- The function MUST remain the default export: export default function App() { ... }
- Preserve ALL existing functionality and responsive design unless asked to change it.
- Keep all existing hooks, state, and handlers intact.
- Apply ONLY the requested changes.
- TypeScript types throughout. Never use \`any\`.
- Use CSS variables for colors, not hardcoded hex/rgb values.
- DARK MODE: never manage dark mode yourself. Do NOT use an isDark state, do NOT add a className="dark" wrapper, do NOT render a theme toggle button. The outer App already applies the .dark class to <html> — your screen inherits it automatically.`;

export function getScreenUpdatePrompt(iconLibrary: IconLibrary, currentCode?: string, screenIds?: string[], customBase?: string): string {
  const navSection = getNavigationSection(screenIds ?? []);
  const codeSection = currentCode
    ? `\n\nCURRENT CODE — edit this code to apply the user's requested changes:\n\`\`\`tsx\n${currentCode}\n\`\`\``
    : "";
  return `${customBase ?? SCREEN_UPDATE_PROMPT_BASE}\n\n${API_MENTION_RULE}\n\n${getIconLibraryPromptSection(iconLibrary)}${navSection}${codeSection}`;
}