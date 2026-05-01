import { readFile, writeFile, createDir, bunInstallSync, runShellCommandSync, deleteDir, deleteFile, isNotFoundError } from "@/lib/ipc";
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

/** Delete stale eslint.config.ts from old scaffolds, then patch shadcn's eslint.config.js. */
async function patchEslint(projectDir: string): Promise<void> {
  try { await deleteFile(`${projectDir}/eslint.config.ts`) } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }
  const configPath = `${projectDir}/${P.ESLINT_CONFIG_JS}`;
  const raw = await readFile(configPath);
  await writeFile(configPath, patchEslintConfig(raw));
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

  // Step 4: Add non-lucide icon library. lucide-react is already a shadcn
  // dependency — installing it again races with shadcn add's bun install and
  // causes cache conflicts, so we skip it here.
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg && iconLibrary !== "lucide") {
    onStep?.(`Installing ${iconPkg}…`);
    const pkgPath = `${generatedDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstallSync(generatedDir);
  }

  // Step 5: Patch eslint.config.js to ignore shadcn's own false-positive errors
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

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try { savedGenerated = await readFile(`${screenPreviewDir}/${SRC.GENERATED_TSX}`) } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  onStep?.("Removing old files…");
  await removeProjectDir(screenPreviewDir);
  await createDir(projectDir);

  // Step 3: shadcn init
  onStep?.("Initializing Vite + React + shadcn/ui…");
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Add all shadcn components
  onStep?.("Adding shadcn components…");
  await runShellCommandSync(screenPreviewDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 5: Write our App.tsx
  onStep?.("Writing App.tsx…");
  await writeFile(`${screenPreviewDir}/${SRC.APP_TSX}`, getScreenPreviewAppTsx());

  // Step 6: Restore or create Generated.tsx
  onStep?.(savedGenerated ? "Restoring Generated.tsx…" : "Creating Generated.tsx placeholder…");
  await createDir(`${screenPreviewDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${screenPreviewDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(`${screenPreviewDir}/${SRC.GENERATED_TSX}`, getGeneratedPlaceholderTsx());
  }

  // Step 7: Add non-lucide icon library
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg && iconLibrary !== "lucide") {
    onStep?.(`Installing ${iconPkg}…`);
    const pkgPath = `${screenPreviewDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstallSync(screenPreviewDir);
  }

  // Step 8: Patch eslint.config.js to ignore shadcn's own false-positive errors
  // and clean up stale eslint.config.ts from old scaffold versions.
  onStep?.("Patching ESLint config…");
  await patchEslint(screenPreviewDir);
}

/**
 * Check if the generated/ directory has a valid Runner scaffold.
 * Also rejects projects where App.tsx still uses the old Generated.tsx wrapper
 * (written by a previous version of the scaffold code) — those must re-scaffold.
 */
export async function hasGeneratedScaffold(projectDir: string): Promise<boolean> {
  const dir = getGeneratedDirPath(projectDir);
  if (!(await isScaffoldValid(dir))) return false;
  try {
    const appTsx = await readFile(`${dir}/${P.SRC.APP_TSX}`);
    // Old pattern: our code wrote an App.tsx that wraps ./components/Generated
    if (appTsx.includes("./components/Generated")) return false;
  } catch {
    return false;
  }
  return true;
}

