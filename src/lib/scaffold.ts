import { readFile, writeFile, createDir, readDir, bunInstallSync, runShellCommandSync, deleteDir, deleteFile, isNotFoundError } from "@/lib/ipc";
import { ICON_LIBRARY_PACKAGES } from "@/lib/prompts";
import type { IconLibrary } from "@/lib/prompts";
import {
  SHADCN_INIT_COMMAND,
  SHADCN_ADD_COMMAND,
  PROJECT_PATHS,
  patchEslintConfig,
  getGeneratedDirPath,
  getGeneratedMainTsx,
  getGeneratedAppTsx,
  getRouterTsx,
  getGeneratedViteConfig,
  getThemePreviewTsx,
} from "@/lib/scaffold-shadcn";

const P = PROJECT_PATHS;
const SRC = P.SRC;

/**
 * Check if a directory contains a valid scaffolded project by verifying
 * the structural markers that `shadcn init` creates.
 *
 * Checks for the actual files that prove shadcn ran successfully:
 * - `package.json` — project exists
 * - `components.json` — shadcn init completed
 * - `src/index.css` — shadcn wrote its CSS
 * - `src/lib/utils.ts` — shadcn wrote the cn() utility
 * - `src/App.tsx` — our post-init override was applied
 *
 * If any of these are missing, the scaffold is considered invalid
 * and will be re-created.
 */
async function isScaffoldValid(dir: string): Promise<boolean> {
  try {
    await readFile(`${dir}/${P.PACKAGE_JSON}`);
    await readFile(`${dir}/${P.COMPONENTS_JSON}`);
    await readFile(`${dir}/${P.ESLINT_CONFIG_JS}`);
    await readFile(`${dir}/${SRC.INDEX_CSS}`);
    await readFile(`${dir}/${SRC.UTILS_TS}`);
    await readFile(`${dir}/${SRC.APP_TSX}`);
    return true;
  } catch {
    return false;
  }
}

/** Validates that a directory name segment is safe to interpolate into a shell command. */
function assertSafeDirName(name: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid project directory name: "${name}"`);
  }
}

/**
 * Remove a project directory, tolerating it not existing.
 * Uses Rust's remove_dir_all which is recursive.
 */
async function removeProjectDir(dir: string): Promise<void> {
  try { await deleteDir(dir) } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }
}

/** Delete stale eslint.config.ts from old scaffolds, then patch shadcn's eslint.config.js. Idempotent. */
async function patchEslint(projectDir: string): Promise<void> {
  try { await deleteFile(`${projectDir}/eslint.config.ts`) } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }
  const configPath = `${projectDir}/${P.ESLINT_CONFIG_JS}`;
  try {
    const raw = await readFile(configPath);
    const patched = patchEslintConfig(raw);
    if (patched !== raw) {
      await writeFile(configPath, patched);
    }
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }
}

/**
 * Ensure eslint.config.js has shadcn ignores in the generated/ project.
 * Idempotent — safe to call on every project open.
 */
export async function ensureEslintPatched(projectDir: string): Promise<void> {
  await patchEslint(getGeneratedDirPath(projectDir));
}

/**
 * Scaffold a React + TypeScript + Vite project with shadcn/ui
 * in the generated/ directory.
 *
 * Flow:
 * 1. Remove the target directory so shadcn can create it fresh.
 * 2. `shadcn init -t vite -b radix -p nova --name generated` (awaits completion).
 * 3. `shadcn add --all` (awaits completion).
 * 4. Add non-lucide icon library if selected.
 *
 * App.tsx is NOT overwritten — shadcn init generates it with the Nova preset.
 */
export async function scaffoldGenerated(
  generatedDir: string,
  iconLibrary: IconLibrary,
  onStep?: (msg: string) => void
): Promise<void> {
  const projectDir = generatedDir.substring(0, generatedDir.lastIndexOf("/"));
  const dirName = generatedDir.substring(generatedDir.lastIndexOf("/") + 1);
  assertSafeDirName(dirName);

  // Step 1: Remove the target directory so shadcn can create it fresh
  onStep?.("Removing old files…");
  await removeProjectDir(generatedDir);
  await createDir(projectDir);

  // Step 2: shadcn init — creates the full Vite + React + shadcn project with its own App.tsx
  onStep?.("Initializing Vite + React + shadcn/ui…");
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 3: Add all shadcn components and install their deps
  onStep?.("Adding shadcn components…");
  await runShellCommandSync(generatedDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 4: Add @tanstack/react-query, react-router-dom, and optional icon library
  onStep?.("Installing TanStack Query + React Router…");
  const pkgPath = `${generatedDir}/${P.PACKAGE_JSON}`;
  const pkgRaw = await readFile(pkgPath);
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  const deps = (pkg.dependencies as Record<string, string>) || {};
  deps["@tanstack/react-query"] = "^5.0.0";
  deps["react-router-dom"] = "^7.0.0";

  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg && iconLibrary !== "lucide") {
    onStep?.(`Installing ${iconPkg}…`);
    deps[iconPkg] = "latest";
  }

  pkg.dependencies = deps;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
  await bunInstallSync(generatedDir);

  // Step 5: Write main.tsx with QueryClientProvider + BrowserRouter
  onStep?.("Writing main.tsx…");
  await writeFile(`${generatedDir}/${P.SRC.MAIN_TSX}`, getGeneratedMainTsx());

  // Step 6: Write router.tsx stub (populated by Flows panel)
  await writeFile(`${generatedDir}/${P.SRC.ROUTER_TSX}`, getRouterTsx());

  // Step 7: Overwrite App.tsx with our AppRouter shell
  await writeFile(`${generatedDir}/${P.SRC.APP_TSX}`, getGeneratedAppTsx());

  // Step 8: Write vite.config.ts (no proxy entries yet — synced from API panel)
  await writeFile(`${generatedDir}/${P.VITE_CONFIG_TS}`, getGeneratedViteConfig());

  // Step 9: Create conventional project directories
  onStep?.("Creating project structure…");
  await Promise.all([
    createDir(`${generatedDir}/${SRC.PAGES_DIR}`),
    createDir(`${generatedDir}/${SRC.ASSETS_DIR}`),
    createDir(`${generatedDir}/${SRC.HOOKS_DIR}`),
    createDir(`${generatedDir}/${SRC.SERVICES_DIR}`),
    createDir(`${generatedDir}/${SRC.UTILS_DIR}`),
    createDir(`${generatedDir}/${SRC.TYPES_DIR}`),
    createDir(`${generatedDir}/${SRC.STYLES_DIR}`),
  ]);

  // Step 10: Write preview-theme.css (populated at runtime by ThemesPanel)
  await writeFile(`${generatedDir}/${SRC.PREVIEW_THEME_CSS}`, "");

  // Step 11: Write __theme-preview.tsx (static shadcn sample page for ThemesPanel)
  await writeFile(`${generatedDir}/${SRC.THEME_PREVIEW_TSX}`, getThemePreviewTsx());

  // Step 12: Patch eslint.config.js to ignore shadcn's own false-positive errors
  // and clean up stale eslint.config.ts from old scaffold versions.
  onStep?.("Patching ESLint config…");
  await patchEslint(generatedDir);
}



export async function hasGeneratedScaffold(projectDir: string): Promise<boolean> {
  const dir = getGeneratedDirPath(projectDir);
  if (!(await isScaffoldValid(dir))) return false;
  try {
    const appTsx = await readFile(`${dir}/${P.SRC.APP_TSX}`);
    // Old pattern: code that wraps ./components/Generated needs a full re-scaffold
    if (appTsx.includes("./components/Generated")) return false;
    // Missing router.tsx needs a full re-scaffold
    await readFile(`${dir}/${P.SRC.ROUTER_TSX}`);
    // Old-style scaffold without unified preview architecture needs a full re-scaffold
    await readDir(`${dir}/${P.SRC.PAGES_DIR}`);
  } catch {
    return false;
  }
  return true;
}

/**
 * Sync Vite proxy config for the generated/ app.
 * Called from the API panel whenever API keys / proxy mappings change.
 *
 * @param generatedDir  Absolute path to the generated/ directory
 * @param proxy         Map of path prefix → target host
 */
export async function syncViteProxy(
  generatedDir: string,
  proxy: Record<string, string>
): Promise<void> {
  await writeFile(`${generatedDir}/${P.VITE_CONFIG_TS}`, getGeneratedViteConfig(proxy));
}


