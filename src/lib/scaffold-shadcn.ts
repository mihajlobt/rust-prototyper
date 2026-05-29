/**
 * Shared constants and templates for scaffolding shadcn/ui projects.
 *
 * Used by both `scaffoldComponentPreview()` (component-preview/) and
 * `scaffoldGenerated()` (generated/) to ensure consistent project setup.
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
    GENERATED_TSX: "src/components/Generated.tsx",
    PREVIEW_THEME_CSS: "src/styles/preview-theme.css",
    COMPONENTS_DIR: "src/components",
    STYLES_DIR: "src/styles",
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

/**
 * Returns the App.tsx for the component-preview/ or screen-preview/ project.
 * Sets dark class on documentElement so body { bg-background } picks up the
 * dark CSS variables. Reads initial state from ?dark= query param (sync, before
 * React mounts) and listens for set-dark postMessage for live toggling.
 *
 * Includes a class-based error boundary around <Generated /> that catches
 * render and commit-phase errors (e.g. React 19 frozen-props TypeError from
 * malformed AI-generated code) and displays a styled fallback with a retry
 * button, keeping the dark-mode shell and message listener intact.
 */
export function getPreviewAppTsx(cssImports: string[]): string {
  const imports = cssImports.map((p) => `import "${p}"`).join("\n");
  return `import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
${imports}
import GeneratedComponent from "./${PROJECT_PATHS.SRC.GENERATED_TSX.replace('src/', '').replace('.tsx', '')}"
// Cast away required props — App.tsx renders the component without props at preview time.
// The AI may define required props; casting to ComponentType prevents TS2739 here.
const Generated = GeneratedComponent as React.ComponentType

const queryClient = new QueryClient()

interface ErrorBoundaryState { hasError: boolean; error: Error | null }

class PreviewErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  constructor(props: React.PropsWithChildren) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[PreviewErrorBoundary]", error, info)
  }

  render() {
    if (this.state.hasError) {
      const msg = this.state.error?.message || "An unexpected error occurred"
      return (
        <div style={{
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          height: "100%", width: "100%", padding: "24px", gap: "8px", textAlign: "center",
        }}>
          <p style={{ fontSize: "12px", fontWeight: 600, color: "var(--destructive, #ef4444)" }}>Preview Error</p>
          <p style={{ fontSize: "11px", color: "var(--muted-foreground, #888)", maxWidth: "100%", lineHeight: 1.4, wordBreak: "break-word" }}>{msg}</p>
          <button style={{
            marginTop: "4px", padding: "4px 12px", fontSize: "11px", fontWeight: 500,
            border: "1px solid var(--border, #333)", borderRadius: "6px",
            background: "transparent", color: "var(--foreground, #eee)", cursor: "pointer",
          }} onClick={() => this.setState({ hasError: false, error: null })}>Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

function App() {
  const [dark, setDark] = React.useState(() => {
    const d = new URLSearchParams(window.location.search).get("dark") === "true"
    document.documentElement.classList.toggle("dark", d)
    return d
  })

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "set-dark") setDark(e.data.value as boolean)
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <PreviewErrorBoundary>
        <Generated />
      </PreviewErrorBoundary>
    </QueryClientProvider>
  )
}

export default App
`;
}

/** Returns the App.tsx for the component-preview/ project (includes preview-theme.css). */
export function getAppTsx(): string {
  return getPreviewAppTsx([
    `./${PROJECT_PATHS.SRC.INDEX_CSS.replace('src/', '')}`,
    `./${PROJECT_PATHS.SRC.PREVIEW_THEME_CSS.replace('src/', '')}`,
  ]);
}

/** Returns the App.tsx for the screen-preview/ project — React Router shell with all screens as routes. */
export function getScreenPreviewAppTsx(): string {
  return `import React, { useEffect } from "react"
import "./index.css"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { routes, defaultPath } from "./routes";

const queryClient = new QueryClient()

function NavigationListener() {
  const navigate = useNavigate();
  useEffect(() => {
    function handler(event: MessageEvent) {
      if (event.data?.type === "navigate" && typeof event.data.path === "string") {
        navigate(event.data.path);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [navigate]);
  return null;
}

function App() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const dark = params.get("dark") === "true";
    document.documentElement.classList.toggle("dark", dark);

    function handler(event: MessageEvent) {
      if (event.data?.type === "set-dark") {
        document.documentElement.classList.toggle("dark", event.data.value);
      }
    }
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  if (routes.length === 0) {
    return <div style={{ padding: 24, color: "var(--muted-foreground)" }}>No screens yet — create one in the Screens panel.</div>;
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NavigationListener />
        <Routes>
          {routes.map((r) => (
            <Route key={r.path} path={r.path} element={<r.component />} />
          ))}
          <Route path="*" element={<Navigate to={defaultPath} replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

export default App;
`;
}

/** Returns the placeholder Generated.tsx source shown before any component is generated. */
export function getGeneratedPlaceholderTsx(): string {
  return `export default function Generated() {
  return <div style={{ padding: 24 }}>Generated component will appear here</div>;
}
`;
}

/** Returns the placeholder theme CSS file content (populated at runtime when a theme is selected). */
export function getPreviewThemeCss(): string {
  return "";
}

/** Given a project data directory, returns the component-preview directory path. */
export function getComponentPreviewDirPath(projectDir: string): string {
  return `${projectDir}/component-preview`;
}

/** Given a project data directory, returns the screen-preview directory path. */
export function getScreenPreviewDirPath(projectDir: string): string {
  return `${projectDir}/screen-preview`;
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
 * Delegates all routing to AppRouter from router.tsx.
 */
export function getGeneratedAppTsx(): string {
  return `import "./index.css"
import { AppRouter } from "./router"

export default function App() {
  return <AppRouter />
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