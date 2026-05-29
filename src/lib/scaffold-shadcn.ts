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
export function patchEslintConfig(_existingConfig: string): string {
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

/** Returns a static shadcn theme preview page written to generated/src/__theme-preview.tsx at scaffold time. */
export function getThemePreviewTsx(): string {
  return `import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export default function ThemePreview() {
  return (
    <div className="p-8 space-y-6 bg-background min-h-screen">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-1">Theme Preview</h1>
        <p className="text-sm text-muted-foreground">Live preview of your theme applied to shadcn/ui components.</p>
      </div>

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
  // targetUrl stores origin+pathname (e.g. "https://api.example.com/v2/endpoint")
  // Vite proxy target must be origin-only; the pathname becomes the rewrite destination.
  let origin = targetUrl;
  let rewriteTo = "";
  try {
    const p = new URL(targetUrl);
    origin = p.origin;
    rewriteTo = p.pathname !== "/" ? p.pathname : "";
  } catch { /* malformed URL — use as-is */ }
  const safeOrigin = origin.replace(/"/g, "").replace(/\\/g, "");
  const safeRewrite = rewriteTo.replace(/"/g, "").replace(/\\/g, "");
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/');
  return `      "${prefix}": {
        target: "${safeOrigin}",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^${escaped}/, "${safeRewrite}"),
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