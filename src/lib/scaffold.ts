import { readFile, writeFile, createDir, readDir, bunInstallSync, runShellCommandSync, deleteDir, deleteFile, isNotFoundError } from "@/lib/ipc";
import { ICON_LIBRARY_PACKAGES } from "@/lib/prompts";
import type { IconLibrary } from "@/lib/prompts";
import {
  SHADCN_INIT_COMMAND,
  SHADCN_ADD_COMMAND,
  PROJECT_PATHS,
  getAppTsx,
  getScreenPreviewAppTsx,
  getGeneratedPlaceholderTsx,
  getPreviewThemeCss,
  patchEslintConfig,
  getComponentPreviewDirPath,
  getScreenPreviewDirPath,
  getGeneratedDirPath,
  getGeneratedMainTsx,
  getGeneratedAppTsx,
  getRouterTsx,
  getGeneratedViteConfig,
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
 * Ensure eslint.config.js has shadcn ignores in all scaffolded sub-projects.
 * Idempotent — safe to call on every project open. Silently skips directories
 * that don't exist or don't have an eslint config.
 */
export async function ensureEslintPatched(projectDir: string): Promise<void> {
  const subDirs = [
    getGeneratedDirPath(projectDir),
    getComponentPreviewDirPath(projectDir),
    getScreenPreviewDirPath(projectDir),
  ];
  await Promise.all(subDirs.map(patchEslint));
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

  // Step 9: Patch eslint.config.js to ignore shadcn's own false-positive errors
  // and clean up stale eslint.config.ts from old scaffold versions.
  onStep?.("Patching ESLint config…");
  await patchEslint(generatedDir);
}

/**
 * Scaffold a React + TypeScript + Vite project with shadcn/ui
 * in the component-preview/ directory.
 *
 * Flow:
 * 1. Save user's Generated.tsx if it exists.
 * 2. Remove the target directory so shadcn can create it fresh.
 * 3. Run `shadcn init -t vite --yes --name component-preview` (awaits completion).
 * 4. Add all shadcn components via `shadcn add --all` (awaits completion).
 * 5. Write our App.tsx and preview-theme.css.
 * 6. Restore Generated.tsx.
 * 7. Add icon library if selected.
 */
export async function scaffoldComponentPreview(
  componentPreviewDir: string,
  iconLibrary: IconLibrary,
  onStep?: (msg: string) => void
): Promise<void> {
  const projectDir = componentPreviewDir.substring(0, componentPreviewDir.lastIndexOf("/"));
  const dirName = componentPreviewDir.substring(componentPreviewDir.lastIndexOf("/") + 1);
  assertSafeDirName(dirName);

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try { savedGenerated = await readFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`) } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  onStep?.("Removing old files…");
  await removeProjectDir(componentPreviewDir);
  await createDir(projectDir);

  // Step 3: shadcn init — creates the Vite project and installs base deps
  onStep?.("Initializing Vite + React + shadcn/ui…");
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Add all shadcn components and install their deps
  onStep?.("Adding shadcn components…");
  await runShellCommandSync(componentPreviewDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 5: Write our App.tsx (overwrites shadcn's placeholder)
  onStep?.("Writing App.tsx…");
  await writeFile(`${componentPreviewDir}/${SRC.APP_TSX}`, getAppTsx());

  // Step 6: Write preview-theme.css (runtime theme overlay)
  await createDir(`${componentPreviewDir}/${SRC.STYLES_DIR}`);
  await writeFile(`${componentPreviewDir}/${SRC.PREVIEW_THEME_CSS}`, getPreviewThemeCss());

  // Step 7: Restore or create Generated.tsx
  onStep?.(savedGenerated ? "Restoring Generated.tsx…" : "Creating Generated.tsx placeholder…");
  await createDir(`${componentPreviewDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`, getGeneratedPlaceholderTsx());
  }

  // Step 8: Add non-lucide icon library. lucide-react is already a shadcn
  // dependency — skip it to avoid racing with shadcn add's bun install.
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg && iconLibrary !== "lucide") {
    onStep?.(`Installing ${iconPkg}…`);
    const pkgPath = `${componentPreviewDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstallSync(componentPreviewDir);
  }

  // Step 9: Patch eslint.config.js to ignore shadcn's own false-positive errors
  // and clean up stale eslint.config.ts from old scaffold versions.
  onStep?.("Patching ESLint config…");
  await patchEslint(componentPreviewDir);
}

/**
 * Check if the component-preview/ directory has a valid scaffold
 * by verifying structural files exist.
 */
export async function hasComponentPreviewScaffold(projectDir: string): Promise<boolean> {
  return isScaffoldValid(getComponentPreviewDirPath(projectDir));
}

/**
 * Check if the screen-preview/ directory has a valid scaffold
 * by verifying structural files exist.
 */
export async function hasScreenPreviewScaffold(projectDir: string): Promise<boolean> {
  return isScaffoldValid(getScreenPreviewDirPath(projectDir));
}

/**
 * Scaffold a React + TypeScript + Vite project with shadcn/ui
 * in the screen-preview/ directory.
 *
 * Same flow as scaffoldComponentPreview but without preview-theme.css.
 */
export async function scaffoldScreenPreview(
  screenPreviewDir: string,
  iconLibrary: IconLibrary,
  onStep?: (msg: string) => void
): Promise<void> {
  const projectDir = screenPreviewDir.substring(0, screenPreviewDir.lastIndexOf("/"));
  const dirName = screenPreviewDir.substring(screenPreviewDir.lastIndexOf("/") + 1);
  assertSafeDirName(dirName);

  // Step 1: Remove the target directory so shadcn can create it fresh
  onStep?.("Removing old files…");
  await removeProjectDir(screenPreviewDir);
  await createDir(projectDir);

  // Step 3: shadcn init
  onStep?.("Initializing Vite + React + shadcn/ui…");
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Add all shadcn components
  onStep?.("Adding shadcn components…");
  await runShellCommandSync(screenPreviewDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 5: Install react-router-dom for the navigation router shell
  onStep?.("Installing react-router-dom…");
  const pkgPath = `${screenPreviewDir}/${P.PACKAGE_JSON}`;
  const pkgRaw = await readFile(pkgPath);
  const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
  const deps = (pkg.dependencies as Record<string, string>) || {};
  deps["react-router-dom"] = "^7.0.0";

  // Step 6: Add non-lucide icon library
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg && iconLibrary !== "lucide") {
    deps[iconPkg] = "latest";
  }
  pkg.dependencies = deps;
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
  await bunInstallSync(screenPreviewDir);

  // Step 7: Write router App.tsx and initial empty routes.ts
  onStep?.("Writing App.tsx…");
  await writeFile(`${screenPreviewDir}/${SRC.APP_TSX}`, getScreenPreviewAppTsx());
  await writeFile(
    `${screenPreviewDir}/src/routes.ts`,
    `// Auto-generated by Prototyper — do not edit manually.\nimport type { ComponentType } from 'react';\nexport const routes: Array<{ path: string; component: ComponentType }> = [];\nexport const defaultPath = "/";\n`
  );

  // Step 8: Patch eslint.config.js to ignore shadcn's own false-positive errors
  // and clean up stale eslint.config.ts from old scaffold versions.
  onStep?.("Patching ESLint config…");
  await patchEslint(screenPreviewDir);
}

/**
 * Ensure the project-level data/ directory exists with a store.ts entry point.
 * Called on panel mount — idempotent, safe to call repeatedly.
 * The agent uses @/data/store to import and extend mock data across screens and components.
 */
export async function ensureDataDir(projectDir: string): Promise<void> {
  const dataDir = `${projectDir}/data`;
  const storePath = `${dataDir}/store.ts`;
  try {
    await readFile(storePath);
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
    await createDir(dataDir);
    await writeFile(storePath, `// Shared mock data — imported by components and screens via @/data/store\n// The AI agent will add exports here as it creates data files.\n`);
  }
}

/**
 * Ensure every component and screen directory has a scoped tsconfig.json.
 * New dirs get it at creation time (SidebarRail.tsx), but pre-existing ones do not.
 * Idempotent — safe to call on every project open. Silently skips missing dirs.
 */
export async function ensureTsconfigs(projectDir: string): Promise<void> {
  const sections: Array<{ subdir: string; tsconfig: object }> = [
    {
      subdir: "components",
      tsconfig: {
        extends: "../../component-preview/tsconfig.app.json",
        compilerOptions: { noUnusedLocals: false, noUnusedParameters: false, types: [], typeRoots: ["../../component-preview/node_modules/@types"] },
        files: ["component.tsx"],
      },
    },
    {
      subdir: "screens",
      tsconfig: {
        extends: "../../component-preview/tsconfig.app.json",
        compilerOptions: { noUnusedLocals: false, noUnusedParameters: false, types: [], typeRoots: ["../../component-preview/node_modules/@types"] },
        files: ["screen.tsx"],
      },
    },
  ];

  await Promise.all(
    sections.map(async ({ subdir, tsconfig }) => {
      let entries;
      try {
        entries = await readDir(`${projectDir}/${subdir}`);
      } catch {
        return;
      }
      await Promise.all(
        entries
          .filter((e) => e.is_dir)
          .map(async (entry) => {
            const tsconfigPath = `${projectDir}/${subdir}/${entry.name}/tsconfig.json`;
            try {
              await readFile(tsconfigPath);
            } catch (e) {
              if (!isNotFoundError(e)) throw e;
              await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));
            }
          })
      );
    })
  );
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
    // Note: if App.tsx is missing AppRouter, RunnerPanel migrates it silently
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

