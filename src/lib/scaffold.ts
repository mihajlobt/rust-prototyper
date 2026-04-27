import { readFile, writeFile, createDir, bunInstall, runShellCommand, deleteDir } from "@/lib/ipc";
import { ICON_LIBRARY_PACKAGES } from "@/lib/prompts";
import type { IconLibrary } from "@/lib/prompts";
import {
  SHADCN_INIT_COMMAND,
  SHADCN_ADD_COMMAND,
  PROJECT_PATHS,
  getAppTsx,
  getGeneratedPlaceholderTsx,
  getPreviewThemeCss,
  getComponentPreviewDirPath,
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
    await readFile(`${dir}/${SRC.INDEX_CSS}`);
    await readFile(`${dir}/${SRC.UTILS_TS}`);
    await readFile(`${dir}/${SRC.APP_TSX}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Poll until a file exists or timeout is reached.
 */
async function waitForFile(path: string, timeoutMs = 30000, intervalMs = 500): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await readFile(path);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  throw new Error(`Timeout waiting for ${path} to appear after ${timeoutMs}ms`);
}

/**
 * Remove a project directory, tolerating it not existing.
 * Uses Rust's remove_dir_all which is recursive.
 */
async function removeProjectDir(dir: string): Promise<void> {
  try {
    await deleteDir(dir);
  } catch {
    // May not exist, that's fine
  }
}

/**
 * Scaffold a React + TypeScript + Vite project with shadcn/ui
 * in the generated/ directory.
 *
 * Follows shadcn Vite docs: shadcn init creates the entire project,
 * then we add our files on top.
 *
 * Flow:
 * 1. Save user's Generated.tsx if it exists.
 * 2. Remove the target directory so shadcn can create it fresh.
 * 3. Run `shadcn init -t vite --yes --name generated`
 *    in the parent directory (creates generated/ subdirectory).
 * 4. Wait for shadcn to finish (check for package.json + components.json).
 * 5. Add all shadcn components via `shadcn add --all`.
 * 6. Install dependencies after adding components.
 * 7. Write our App.tsx and preview-theme.css.
 * 8. Restore Generated.tsx.
 * 9. Add icon library if selected.
 */
export async function scaffoldGenerated(
  generatedDir: string,
  iconLibrary: IconLibrary
): Promise<void> {
  // The parent directory (e.g. "projects/abc")
  const projectDir = generatedDir.substring(0, generatedDir.lastIndexOf("/"));
  const dirName = generatedDir.substring(generatedDir.lastIndexOf("/") + 1);

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try {
    savedGenerated = await readFile(`${generatedDir}/${SRC.GENERATED_TSX}`);
  } catch {
    // Doesn't exist yet
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  await removeProjectDir(generatedDir);
  // Ensure parent directory exists
  await createDir(projectDir);

  // Step 3: Run shadcn init — creates the entire Vite + shadcn project
  await runShellCommand(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Wait for shadcn to finish creating the project
  await waitForFile(`${generatedDir}/${P.PACKAGE_JSON}`, 60000);
  await waitForFile(`${generatedDir}/${P.COMPONENTS_JSON}`, 60000);

  // Step 5: Add all shadcn components
  await runShellCommand(generatedDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 6: Install dependencies after adding components
  await bunInstall(generatedDir);
  await waitForFile(`${generatedDir}/${P.VITE_PKG}`);

  // Step 7: Write our App.tsx (overwrites shadcn's placeholder)
  await writeFile(`${generatedDir}/${SRC.APP_TSX}`, getAppTsx());

  // Step 8: Write preview-theme.css (runtime theme overlay)
  await createDir(`${generatedDir}/${SRC.STYLES_DIR}`);
  await writeFile(`${generatedDir}/${SRC.PREVIEW_THEME_CSS}`, getPreviewThemeCss());

  // Step 9: Restore or create Generated.tsx
  await createDir(`${generatedDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${generatedDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(`${generatedDir}/${SRC.GENERATED_TSX}`, getGeneratedPlaceholderTsx());
  }

  // Step 10: Add icon library if selected
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg) {
    const pkgPath = `${generatedDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstall(generatedDir);
    await waitForFile(`${generatedDir}/${P.VITE_PKG}`);
  }
}

/**
 * Scaffold a React + TypeScript + Vite project with shadcn/ui
 * in the component-preview/ directory.
 *
 * Follows shadcn Vite docs: shadcn init creates the entire project,
 * then we add our files on top.
 *
 * Flow:
 * 1. Save user's Generated.tsx if it exists.
 * 2. Remove the target directory so shadcn can create it fresh.
 * 3. Run `shadcn init -t vite --yes --name component-preview`
 *    in the parent directory (creates component-preview/ subdirectory).
 * 4. Wait for shadcn to finish (check for package.json + components.json).
 * 5. Add all shadcn components via `shadcn add --all`.
 * 6. Install dependencies after adding components.
 * 7. Write our App.tsx and preview-theme.css.
 * 8. Restore Generated.tsx.
 * 9. Add icon library if selected.
 */
export async function scaffoldComponentPreview(
  componentPreviewDir: string,
  iconLibrary: IconLibrary
): Promise<void> {
  // The parent directory (e.g. "projects/abc")
  const projectDir = componentPreviewDir.substring(0, componentPreviewDir.lastIndexOf("/"));
  const dirName = componentPreviewDir.substring(componentPreviewDir.lastIndexOf("/") + 1);

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try {
    savedGenerated = await readFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`);
  } catch {
    // Doesn't exist yet
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  await removeProjectDir(componentPreviewDir);
  // Ensure parent directory exists
  await createDir(projectDir);

  // Step 3: Run shadcn init — creates the entire Vite + shadcn project
  await runShellCommand(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Wait for shadcn to finish creating the project
  await waitForFile(`${componentPreviewDir}/${P.PACKAGE_JSON}`, 60000);
  await waitForFile(`${componentPreviewDir}/${P.COMPONENTS_JSON}`, 60000);

  // Step 5: Add all shadcn components
  await runShellCommand(componentPreviewDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 6: Install dependencies after adding components
  await bunInstall(componentPreviewDir);
  await waitForFile(`${componentPreviewDir}/${P.VITE_PKG}`);

  // Step 7: Write our App.tsx (overwrites shadcn's placeholder)
  await writeFile(`${componentPreviewDir}/${SRC.APP_TSX}`, getAppTsx());

  // Step 8: Write preview-theme.css (runtime theme overlay)
  await createDir(`${componentPreviewDir}/${SRC.STYLES_DIR}`);
  await writeFile(
    `${componentPreviewDir}/${SRC.PREVIEW_THEME_CSS}`,
    getPreviewThemeCss()
  );

  // Step 9: Restore or create Generated.tsx
  await createDir(`${componentPreviewDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(
      `${componentPreviewDir}/${SRC.GENERATED_TSX}`,
      getGeneratedPlaceholderTsx()
    );
  }

  // Step 10: Add icon library if selected
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg) {
    const pkgPath = `${componentPreviewDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstall(componentPreviewDir);
    await waitForFile(`${componentPreviewDir}/${P.VITE_PKG}`);
  }
}

/**
 * Check if the component-preview/ directory has a valid scaffold
 * by verifying structural files exist.
 */
export async function hasComponentPreviewScaffold(projectDir: string): Promise<boolean> {
  return isScaffoldValid(getComponentPreviewDirPath(projectDir));
}

/**
 * Check if the generated/ directory has a valid scaffold
 * by verifying structural files exist.
 */
export async function hasGeneratedScaffold(projectDir: string): Promise<boolean> {
  return isScaffoldValid(getGeneratedDirPath(projectDir));
}