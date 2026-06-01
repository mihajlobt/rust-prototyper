/**
 * Shared constants, path patches, and the simple `getGeneratedDirPath` helper
 * for scaffolding shadcn/ui projects.
 *
 * See ./scaffold-shadcn.ts for the barrel re-export.
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

/** Given a project data directory, returns the generated directory path. */
export function getGeneratedDirPath(projectDir: string): string {
  return `${projectDir}/generated`;
}
