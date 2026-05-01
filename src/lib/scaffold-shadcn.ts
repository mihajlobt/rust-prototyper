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
  VITE_PKG: "node_modules/vite/package.json",
  SRC: {
    APP_TSX: "src/App.tsx",
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
 * --reinstall      re-install existing UI components
 * (-y/--yes defaults to true per CLI docs, not needed)
 *
 * Tested non-interactively in /tmp — all prompts suppressed, exit 0.
 * Ref: https://ui.shadcn.com/docs/cli — init options
 */
export const SHADCN_INIT_COMMAND: string =
  "bunx --bun shadcn@latest init -t vite -b radix -p nova --no-monorepo --no-rtl --pointer --reinstall";

/**
 * Patches shadcn's eslint.config.js to add globalIgnores for shadcn's own files.
 * Shadcn components trigger react-refresh/only-export-components and
 * react-hooks/set-state-in-effect — both false positives in library code.
 * Refs: https://github.com/shadcn-ui/ui/issues/7736
 *       https://github.com/shadcn-ui/ui/issues/8739
 *       https://eslint.org/docs/latest/use/configure/configuration-files#globally-ignore-files-with-ignores
 */
export function patchEslintConfig(config: string): string {
  return config.replace(
    /globalIgnores\(\[(.*?)\]\)/s,
    (_match, inner) => {
      const existing = inner
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
      const additions = [
        "'src/components/ui/**'",
        "'src/hooks/use-mobile.ts'",
      ];
      const merged = [...new Set([...existing, ...additions])];
      return `globalIgnores([${merged.join(", ")}])`;
    }
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
${imports}
import Generated from "./${PROJECT_PATHS.SRC.GENERATED_TSX.replace('src/', '').replace('.tsx', '')}"

class PreviewErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
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
    <PreviewErrorBoundary>
      <Generated />
    </PreviewErrorBoundary>
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

/** Returns the App.tsx for the screen-preview/ project (no preview-theme.css). */
export function getScreenPreviewAppTsx(): string {
  return getPreviewAppTsx([`./${PROJECT_PATHS.SRC.INDEX_CSS.replace('src/', '')}`]);
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