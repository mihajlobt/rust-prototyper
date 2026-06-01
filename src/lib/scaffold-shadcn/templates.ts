/**
 * Smaller scaffolding templates: App.tsx, router.tsx, vite.config.ts.
 *
 * See ./scaffold-shadcn.ts for the barrel re-export. The larger templates
 * (main.tsx and __theme-preview.tsx) live in their own files to keep each
 * under the 600-line limit.
 */

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
