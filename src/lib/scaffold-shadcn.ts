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
  "bunx --bun shadcn@latest add --all --yes --overwrite";

/** CLI command to initialize shadcn for Vite. Creates a new project subdirectory. */
export const SHADCN_INIT_COMMAND: string =
  "bunx --bun shadcn@latest init -t vite --yes";

/**
 * Returns the App.tsx source for the scaffolded project.
 *
 * Imports shadcn's index.css (created by shadcn init) and
 * preview-theme.css (our runtime theme overlay), then the Generated component.
 * Listens for postMessage to toggle dark mode.
 */
export function getAppTsx(): string {
  return `import React from "react"
import "./${PROJECT_PATHS.SRC.INDEX_CSS.replace('src/', '')}"
import "./${PROJECT_PATHS.SRC.PREVIEW_THEME_CSS.replace('src/', '')}"
import Generated from "./${PROJECT_PATHS.SRC.GENERATED_TSX.replace('src/', '').replace('.tsx', '')}"

function App() {
  const [dark, setDark] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === "set-dark") {
        setDark(e.data.value)
      }
    }
    window.addEventListener("message", handler)
    return () => window.removeEventListener("message", handler)
  }, [])

  return (
    <div className={dark ? "dark" : ""} style={{ minHeight: "100vh" }}>
      <Generated />
    </div>
  )
}

export default App
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

/** Given a project data directory, returns the generated directory path. */
export function getGeneratedDirPath(projectDir: string): string {
  return `${projectDir}/generated`;
}