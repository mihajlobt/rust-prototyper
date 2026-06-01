/**
 * Shared constants and templates for scaffolding shadcn/ui projects.
 *
 * Follows the shadcn Vite installation docs exactly:
 * https://ui.shadcn.com/docs/installation/vite
 *
 * Key convention: `shadcn init -t vite --name X`
 * creates a subdirectory named X in the CWD. So we run it in the parent
 * directory (e.g. projects/{id}/) and it creates projects/{id}/X/.
 */

/** Path fragments within the scaffolded project directory. */
export const PROJECT_PATHS = {
  PACKAGE_JSON: "package.json",
  COMPONENTS_JSON: "components.json",
  ESLINT_CONFIG_JS: "eslint.config.js",
  VITE_CONFIG_TS: "vite.config.ts",
  VITE_PKG: "node_modules/vite/package.json",
  SRC: {
    APP_TSX: "src/App.tsx",
    MAIN_TSX: "src/main.tsx",
    ROUTER_TSX: "src/router.tsx",
    INDEX_CSS: "src/index.css",
    UTILS_TS: "src/lib/utils.ts",
    PREVIEW_THEME_CSS: "src/styles/preview-theme.css",
    THEME_PREVIEW_TSX: "src/__theme-preview.tsx",
    COMPONENTS_DIR: "src/components",
    STYLES_DIR: "src/styles",
    PAGES_DIR: "src/pages",
    ASSETS_DIR: "src/assets",
    HOOKS_DIR: "src/hooks",
    SERVICES_DIR: "src/services",
    UTILS_DIR: "src/utils",
    TYPES_DIR: "src/types",
  },
} as const;

/**
 * CLI command to add all available shadcn components.
 * Uses --all so shadcn decides what's available for the chosen style,
 * rather than maintaining a hardcoded list that can go stale.
 * https://ui.shadcn.com/docs/cli
 */
export const SHADCN_ADD_COMMAND: string =
  "bunx --bun shadcn@latest add --all --overwrite";

/**
 * CLI command to initialize shadcn for Vite. Creates a new project subdirectory.
 * -t vite          use the Vite template (NOT Next.js)
 * -b radix         pre-select Radix as the component library (skips interactive prompt)
 * -p nova          pre-select Nova preset — skips the "Which preset?" interactive prompt
 * --no-monorepo    suppress the monorepo detection prompt
 * --no-rtl         suppress the RTL direction prompt
 * --pointer        enable pointer cursor for buttons
 * (-y/--yes defaults to true per CLI docs, not needed)
 *
 * Tested non-interactively in /tmp — all prompts suppressed, exit 0.
 * Ref: https://ui.shadcn.com/docs/cli — init options
 */
export const SHADCN_INIT_COMMAND: string =
  "bunx --bun shadcn@latest init -t vite -b radix -p nova --no-monorepo --no-rtl --pointer";

/**
 * Returns the canonical ESLint flat config for a shadcn-scaffolded preview project.
 *
 * Shadcn's generated eslint.config.js is used as the base, with one addition:
 * globalIgnores for src/components/ui/** and src/hooks/use-mobile.ts, which are
 * shadcn-generated library files that legitimately trigger false positives:
 *   - react-refresh/only-export-components  (shadcn exports variants alongside components)
 *   - react-hooks/rules-of-hooks            (use-mobile.ts calls setState in an effect)
 * Refs: https://github.com/shadcn-ui/ui/issues/7736
 *       https://github.com/shadcn-ui/ui/issues/8739
 *
 * `no-undef` and custom globals are intentionally absent — TypeScript (TS2304) catches
 * undefined names with better diagnostics and no false positives.
 *
 * The function ignores its input and always returns the canonical string so that
 * repeated calls (e.g. on every project open) are fully idempotent and cannot
 * accumulate duplicate entries the way regex patching did.
 */
export function patchEslintConfig(): string {
  return `import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'src/components/ui/**', 'src/hooks/use-mobile.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
`;
}

/**
 * Patches a shadcn-generated vite.config.ts to add `server.fs.allow: [".."]`.
 * Without this, Vite blocks imports from symlinked paths outside the project root
 * (e.g. screen-preview/src/screens → ../../screens).
 * Idempotent — safe to call repeatedly.
 */
export function patchViteFsAllow(config: string): string {
  if (config.includes("fs:") && config.includes("allow:")) return config;
  if (config.includes("server:")) {
    // Merge fs.allow into existing server block
    return config.replace(
      /server:\s*\{/,
      "server: {\n    fs: {\n      allow: [\"..\"],\n    },"
    );
  }
  // Add server block before the closing })
  return config.replace(
    /,\n\}\)$/,
    `,\n  server: {\n    fs: {\n      allow: [".."],\n    },\n  },\n})`
  );
}

/**
 * Patches a vite.config.ts to add `resolve.dedupe` for React packages.
 * Without this, symlinked files outside the project root can resolve React
 * independently, producing two React instances and causing "Invalid hook call".
 * Idempotent — safe to call repeatedly.
 */
export function patchViteResolveDedupe(config: string): string {
  const dedupeList = `['react', 'react-dom', 'react-router-dom', 'react-router']`;
  if (config.includes("dedupe:")) return config;
  if (config.includes("resolve:")) {
    // Merge dedupe into existing resolve block
    return config.replace(
      /resolve:\s*\{/,
      `resolve: {\n    dedupe: ${dedupeList},`
    );
  }
  // Add resolve block before the closing })
  return config.replace(
    /,\n\}\)$/,
    `,\n  resolve: {\n    dedupe: ${dedupeList},\n  },\n})`
  );
}

/** Returns a full design-language showcase page written to generated/src/__theme-preview.tsx at scaffold time. The showcase reads the applied design tokens (theme.css variables) for color swatches, typography scale, spacing ramp, radii, shadows, and motion. Works for legacy CSS-only themes too (gracefully skips extended families). */
export function getThemePreviewTsx(): string {
  return `import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const FALLBACK = (key: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(key).trim() || fallback

function TokenSlot({ label, value, cssVar }: { label: string; value?: string; cssVar?: string }) {
  const display = value || (cssVar ? FALLBACK(cssVar, '') : '')
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-border/30 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums">{display}</span>
    </div>
  )
}

function Swatch({ label, cssVar }: { label: string; cssVar: string }) {
  const color = FALLBACK(cssVar, 'transparent')
  return (
    <div className="flex items-center gap-2 text-xs">
      <div className="w-6 h-6 rounded-md border border-border/40 shrink-0" style={{ background: color ? 'var(' + cssVar + ')' : undefined }} />
      <div className="flex-1 min-w-0">
        <div className="font-mono text-[10px] text-muted-foreground truncate">{cssVar}</div>
        <div className="truncate font-medium">{label}</div>
      </div>
    </div>
  )
}

function ShowcaseTab() {
  const fonts = [
    { label: 'Sans', cssVar: '--font-sans', sample: 'The quick brown fox jumps over the lazy dog.' },
    { label: 'Display', cssVar: '--font-display', sample: 'Display Heading' },
    { label: 'Mono', cssVar: '--font-mono', sample: 'import { useState } from "react"' },
    { label: 'Serif', cssVar: '--font-serif', sample: 'The quick brown fox jumps over the lazy dog.' },
  ].filter((f) => !!FALLBACK(f.cssVar, ''))

  const typeScale = [
    { label: 'XS', cssVar: '--text-xs' },
    { label: 'SM', cssVar: '--text-sm' },
    { label: 'Base', cssVar: '--text-base' },
    { label: 'LG', cssVar: '--text-lg' },
    { label: 'XL', cssVar: '--text-xl' },
    { label: '2XL', cssVar: '--text-2xl' },
    { label: '3XL', cssVar: '--text-3xl' },
    { label: '4XL', cssVar: '--text-4xl' },
  ]

  const spaceScale = [
    { label: 'XS', cssVar: '--space-xs' },
    { label: 'SM', cssVar: '--space-sm' },
    { label: 'MD', cssVar: '--space-md' },
    { label: 'LG', cssVar: '--space-lg' },
    { label: 'XL', cssVar: '--space-xl' },
    { label: '2XL', cssVar: '--space-2xl' },
    { label: '3XL', cssVar: '--space-3xl' },
  ]

  const radiiScale = [
    { label: 'SM', cssVar: '--radius-sm' },
    { label: 'MD', cssVar: '--radius-md' },
    { label: 'LG', cssVar: '--radius-lg' },
    { label: 'Full', cssVar: '--radius-full' },
  ]

  const shadowScale = [
    { label: 'SM', cssVar: '--shadow-sm' },
    { label: 'MD', cssVar: '--shadow-md' },
    { label: 'LG', cssVar: '--shadow-lg' },
    { label: 'XL', cssVar: '--shadow-xl' },
  ]

  const motionScale = [
    { label: 'Fast', cssVar: '--duration-fast' },
    { label: 'Normal', cssVar: '--duration-normal' },
    { label: 'Slow', cssVar: '--duration-slow' },
  ]

  const hasExtended = !!FALLBACK('--font-sans', '')

  return (
    <div className="space-y-6">
      {/* Color swatches — light (always shown) */}
      <Card>
        <CardHeader>
          <CardTitle>Semantic Colors — Light</CardTitle>
          <CardDescription>Surface, accent, and action tokens in light mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Swatch label="Background" cssVar="--background" />
            <Swatch label="Foreground" cssVar="--foreground" />
            <Swatch label="Card" cssVar="--card" />
            <Swatch label="Card Foreground" cssVar="--card-foreground" />
            <Swatch label="Popover" cssVar="--popover" />
            <Swatch label="Popover Foreground" cssVar="--popover-foreground" />
            <Swatch label="Primary" cssVar="--primary" />
            <Swatch label="Primary Foreground" cssVar="--primary-foreground" />
            <Swatch label="Secondary" cssVar="--secondary" />
            <Swatch label="Secondary Foreground" cssVar="--secondary-foreground" />
            <Swatch label="Muted" cssVar="--muted" />
            <Swatch label="Muted Foreground" cssVar="--muted-foreground" />
            <Swatch label="Accent" cssVar="--accent" />
            <Swatch label="Accent Foreground" cssVar="--accent-foreground" />
            <Swatch label="Destructive" cssVar="--destructive" />
            <Swatch label="Destructive Foreground" cssVar="--destructive-foreground" />
            <Swatch label="Border" cssVar="--border" />
            <Swatch label="Input" cssVar="--input" />
            <Swatch label="Ring" cssVar="--ring" />
          </div>
        </CardContent>
      </Card>

      {/* Color swatches — dark */}
      <Card className="dark">
        <CardHeader>
          <CardTitle>Semantic Colors — Dark</CardTitle>
          <CardDescription>Adaptive surface values in dark mode.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Swatch label="Background" cssVar="--background" />
            <Swatch label="Foreground" cssVar="--foreground" />
            <Swatch label="Card" cssVar="--card" />
            <Swatch label="Primary" cssVar="--primary" />
            <Swatch label="Secondary" cssVar="--secondary" />
            <Swatch label="Muted" cssVar="--muted" />
            <Swatch label="Accent" cssVar="--accent" />
            <Swatch label="Destructive" cssVar="--destructive" />
            <Swatch label="Border" cssVar="--border" />
          </div>
        </CardContent>
      </Card>

      {/* Typography */}
      <Card>
        <CardHeader>
          <CardTitle>Typography</CardTitle>
          <CardDescription>Font families and type scale.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {hasExtended ? (
            fonts.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-mono text-muted-foreground">{f.cssVar}</span>
                  <span className="font-medium">{FALLBACK(f.cssVar, '')}</span>
                </div>
                <div style={{ fontFamily: 'var(' + f.cssVar + ')' }} className="text-sm">{f.sample}</div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Extended typography tokens are not defined in this theme.</p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2">
            {typeScale.map((t) => (
              <div key={t.label} className={"p-2 rounded border border-border/30 " + (FALLBACK(t.cssVar, '') ? "" : "opacity-40")}>
                <div className="text-[10px] text-muted-foreground font-mono">{t.cssVar}</div>
                <div style={{ fontSize: 'var(' + t.cssVar + ')' }} className="leading-tight">Aa</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Spacing */}
      <Card>
        <CardHeader>
          <CardTitle>Spacing</CardTitle>
          <CardDescription>Base unit and scale ramp.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <TokenSlot label="Base unit" cssVar="--space-base" />
            {spaceScale.map((s) => (
              <div key={s.label} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-10 shrink-0">{s.label}</span>
                <span className="font-mono tabular-nums w-14 shrink-0">{FALLBACK(s.cssVar, '')}</span>
                <div className="h-2 bg-primary rounded-sm" style={{ width: FALLBACK(s.cssVar, '0px'), opacity: 0.6 }} />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Radii */}
      <Card>
        <CardHeader>
          <CardTitle>Radii</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          {radiiScale.map((r) => (
            <div key={r.label} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 bg-primary/60 border border-border/40" style={{ borderRadius: 'var(' + r.cssVar + ')' }} />
              <span className="text-[10px] text-muted-foreground">{r.label}</span>
            </div>
          ))}
          <div className="flex flex-col items-center gap-1">
            <div className="w-12 h-12 bg-primary/60 border border-border/40" style={{ borderRadius: 'var(--radius)' }} />
            <span className="text-[10px] text-muted-foreground">base</span>
          </div>
        </CardContent>
      </Card>

      {/* Shadows */}
      <Card>
        <CardHeader>
          <CardTitle>Shadows</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4">
          {shadowScale.map((s) => (
            <div key={s.label} className="flex flex-col items-center gap-1">
              <div className="w-12 h-12 bg-card border border-border/40" style={{ boxShadow: 'var(' + s.cssVar + ')' }} />
              <span className="text-[10px] text-muted-foreground">{s.label}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Motion */}
      <Card>
        <CardHeader>
          <CardTitle>Motion</CardTitle>
          <CardDescription>Durations and easing curves.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-3">
            {motionScale.map((m) => (
              <Button key={m.label} size="sm" style={{ transitionDuration: 'var(' + m.cssVar + ')' }} className="hover:bg-primary/80 transition-colors">
                {m.label} ({FALLBACK(m.cssVar, '')})
              </Button>
            ))}
          </div>
          <TokenSlot label="Standard easing" cssVar="--ease-standard" />
          <TokenSlot label="Emphasized easing" cssVar="--ease-emphasized" />
          <TokenSlot label="Decelerate easing" cssVar="--ease-decelerate" />
        </CardContent>
      </Card>

      {/* Component samples (legacy, preserved) */}
      <Card>
        <CardHeader>
          <CardTitle>Buttons</CardTitle>
          <CardDescription>Primary interaction surfaces</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Badges &amp; Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Badge>Default</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Badge variant="outline">Outline</Badge>
            <Badge variant="destructive">Destructive</Badge>
          </div>
          <Input placeholder="Input field" />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Tabs</CardTitle></CardHeader>
        <CardContent>
          <Tabs defaultValue="tab1">
            <TabsList>
              <TabsTrigger value="tab1">Overview</TabsTrigger>
              <TabsTrigger value="tab2">Details</TabsTrigger>
              <TabsTrigger value="tab3">Settings</TabsTrigger>
            </TabsList>
            <TabsContent value="tab1" className="pt-3 text-sm text-muted-foreground">Overview content.</TabsContent>
            <TabsContent value="tab2" className="pt-3 text-sm text-muted-foreground">Details content.</TabsContent>
            <TabsContent value="tab3" className="pt-3 text-sm text-muted-foreground">Settings content.</TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ThemePreview() {
  return (
    <div className="p-8 space-y-6 bg-background min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Design Language Preview</h1>
        <p className="text-sm text-muted-foreground">Live showcase of the active design language applied to shadcn/ui components, tokens, spacing, radii, shadows, and motion.</p>
      </div>
      <ShowcaseTab />
    </div>
  )
}
`;
}

/** Given a project data directory, returns the generated directory path. */
export function getGeneratedDirPath(projectDir: string): string {
  return `${projectDir}/generated`;
}

/**
 * Returns the main.tsx for the generated/ app.
 * Wraps App with QueryClientProvider (TanStack Query) and BrowserRouter.
 */
export function getGeneratedMainTsx(): string {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

const queryClient = new QueryClient()

// Hotspot position tracking
let __hotspots: { id: string; portId?: string; selector: string }[] = [];
let __linkModeCleanup: (() => void) | null = null;
let __retryHandle = 0;

function sendHotspotPositions() {
  if (!__hotspots.length) return;
  const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let found = 0;
  for (const h of __hotspots) {
    try {
      const el = document.querySelector(h.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        // key by id (new) — portId is kept for backward compat with older parents
        positions[h.id] = { x: r.left, y: r.top, w: r.width, h: r.height };
        found++;
      }
    } catch (_) { /* ignore invalid selectors */ }
  }
  window.parent.postMessage({ type: '__hotspot-positions', positions }, '*');
  // React renders async after onLoad — retry until elements appear (up to ~1s)
  if (found < __hotspots.length && __retryHandle < 60) {
    __retryHandle++;
    requestAnimationFrame(sendHotspotPositions);
  } else {
    __retryHandle = 0;
  }
}

document.addEventListener('scroll', sendHotspotPositions, { capture: true, passive: true });
window.addEventListener('resize', sendHotspotPositions, { passive: true });

// Global message listener
window.addEventListener('message', (event) => {
  if (event.data?.type === '__set-hotspots') {
    __hotspots = (event.data.hotspots as { id: string; portId?: string; selector: string }[]) || [];
    __retryHandle = 0;
    sendHotspotPositions();
    return;
  }
  if (event.data?.type === 'disable-link-mode') {
    __linkModeCleanup?.();
    __linkModeCleanup = null;
    return;
  }
  if (event.data?.type === 'enable-element-select') {
    if (!document.body) return;

    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;z-index:50;cursor:crosshair;background:rgba(0,120,255,0.1);pointer-events:all;';
    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#0078ff;color:white;padding:6px 12px;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;z-index:51;';
    info.textContent = 'Click an element to select it (Esc to cancel)';
    overlay.appendChild(info);
    document.body.appendChild(overlay);

    const cleanup = () => {
      overlay.remove();
      document.removeEventListener('click', handler, true);
      document.removeEventListener('keydown', keyHandler);
    };

    const handler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      window.parent.postMessage({
        type: 'element-selected',
        elementTag: target.tagName.toLowerCase(),
        elementText: (target.innerText || '').trim().slice(0, 50),
        elementId: target.id || '',
      }, '*');
      cleanup();
    };

    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

    document.addEventListener('click', handler, true);
    document.addEventListener('keydown', keyHandler);
    return;
  }

  // find-element-at: parent asks iframe to find element at coords and report selector+rect
  if (event.data?.type === 'find-element-at') {
    const { x, y, portId } = event.data;
    if (!document.body) return;
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    console.log('[find-element-at] checking point', x, y, '→ element:', el);
    if (!el || el === document.body || el === document.documentElement) {
      console.log('[find-element-at] no valid element at', x, y);
      return;
    }
    const rect = el.getBoundingClientRect();
    console.log('[find-element-at] found:', el.tagName, el.className, el.id, el);
    window.parent.postMessage({
      type: 'hotspot-created',
      portId,
      selector: getSelector(el),
      rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    }, '*');
    return;
  }

  // Link mode: hover highlights, click creates hotspot and fires element-selected
  if (event.data?.type === 'enable-link-mode') {
    if (!document.body) return;

    const info = document.createElement('div');
    info.style.cssText = 'position:fixed;top:8px;left:50%;transform:translateX(-50%);background:#06b6d4;color:white;padding:6px 12px;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;z-index:51;pointer-events:none;';
    info.textContent = 'Click an element to select it (Esc to cancel)';
    document.body.appendChild(info);

    const style = document.createElement('style');
    style.textContent = '*{cursor:crosshair !important;} [data-link-hover]{outline:2px solid #06b6d4!important;outline-offset:-2px!important;background:rgba(6,182,212,0.15)!important;}';
    document.head.appendChild(style);

    let hoveredEl: HTMLElement | null = null;

    const hoverHandler = (e: MouseEvent) => {
      if (hoveredEl) hoveredEl.removeAttribute('data-link-hover');
      hoveredEl = e.target as HTMLElement;
      hoveredEl.setAttribute('data-link-hover', '');
    };

    const clickHandler = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const target = e.target as HTMLElement;
      console.log('[link-mode] clicked element:', target, target.tagName, target.className, target.id, target.innerText?.slice(0, 30));
      const rect = target.getBoundingClientRect();
      const selector = getSelector(target);
      window.parent.postMessage({
        type: 'element-selected',
        elementTag: target.tagName.toLowerCase(),
        elementText: (target.innerText || '').trim().slice(0, 50),
        elementId: target.id || '',
        selector,
        rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
      }, '*');
      cleanup();
    };

    const cleanup = () => {
      info.remove();
      style.remove();
      if (hoveredEl) hoveredEl.removeAttribute('data-link-hover');
      document.removeEventListener('mouseover', hoverHandler, true);
      document.removeEventListener('click', clickHandler, true);
      document.removeEventListener('keydown', keyHandler);
      __linkModeCleanup = null;
    };

    __linkModeCleanup = cleanup;
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') cleanup(); };

    document.addEventListener('mouseover', hoverHandler, true);
    document.addEventListener('click', clickHandler, true);
    document.addEventListener('keydown', keyHandler);
  }
});

function getSelector(el: Element): string {
  if (el.id) return '#' + el.id;
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.body) {
    const parentEl: HTMLElement | null = current.parentElement;
    if (!parentEl) break;
    const tag = current.tagName.toLowerCase();
    const siblings = Array.from(parentEl.children).filter((c: Element) => c.tagName === current!.tagName);
    const idx = siblings.indexOf(current) + 1;
    parts.unshift(siblings.length > 1 ? tag + ':nth-of-type(' + idx + ')' : tag);
    current = parentEl;
  }
  return parts.join(' > ');
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
`;
}

/**
 * Returns App.tsx for the generated/ app.
 * Includes dark mode support (postMessage + ?dark= param), navigation listener
 * for iframe-driven screen navigation, and preview-theme.css for ThemesPanel.
 */
export function getGeneratedAppTsx(): string {
  return `import { useEffect, Component } from "react"
import type { ReactNode, ErrorInfo } from "react"
import { useNavigate } from "react-router-dom"
import "./index.css"
import "./styles/preview-theme.css"
import { AppRouter } from "./router"

function DarkModeManager() {
  useEffect(() => {
    const dark = new URLSearchParams(window.location.search).get("dark") === "true"
    document.documentElement.classList.toggle("dark", dark)
    function handler(e: MessageEvent) {
      if (e.data?.type === "set-dark") document.documentElement.classList.toggle("dark", e.data.value as boolean)
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])
  return null
}

function NavigationListener() {
  const navigate = useNavigate()
  useEffect(() => {
    function handler(e: MessageEvent) {
      if (e.data?.type === "navigate" && typeof e.data.path === "string") navigate(e.data.path)
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [navigate])
  return null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[AppErrorBoundary]", error, info) }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", color: "red" }}>
          <b>Preview error</b>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
            {(this.state.error as Error).message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

export default function App() {
  return (
    <AppErrorBoundary>
      <DarkModeManager />
      <NavigationListener />
      <AppRouter />
    </AppErrorBoundary>
  )
}
`;
}

/**
 * Returns a router.tsx stub for the generated/ app.
 * Contains no routes initially — populated by syncNavigationToRouter() when
 * the user defines navigation in the Flows panel.
 */
export function getRouterTsx(): string {
  return `// Auto-generated from Flows panel. Edit navigation in the Flows panel, not here.
import { Routes, Route, Navigate } from 'react-router-dom'

export function AppRouter() {
  return (
    <Routes>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
`;
}

/**
 * Returns vite.config.ts for the generated/ app.
 * Includes proxy entries for each API host (keyed by path prefix → target URL)
 * so generated apps can call external APIs without CORS issues.
 *
 * @param proxy  Map of path prefix (e.g. "/api/weather") to target host (e.g. "https://api.openweathermap.org")
 */
export function getGeneratedViteConfig(proxy: Record<string, string> = {}): string {
  const entries = Object.entries(proxy);
  const proxyBlock = entries.length > 0
    ? `
  server: {
    proxy: {
${entries.map(([prefix, targetUrl]) => {
  // Strip only the prefix — caller is responsible for including the full path.
  // e.g. fetch('/api/github/search/repositories?q=react') strips '/api/github'
  //      → '/search/repositories?q=react' → https://api.github.com/search/repositories?q=react
  let origin = targetUrl;
  try {
    origin = new URL(targetUrl).origin;
  } catch { /* malformed URL — use as-is */ }
  const safeOrigin = origin.replace(/"/g, "").replace(/\\/g, "");
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  return `      "${prefix}": {
        target: "${safeOrigin}",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^${escaped}/, ""),
      },`;
}).join('\n')}
    },
  },`
    : '';

  return `import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },${proxyBlock}
})
`;
}