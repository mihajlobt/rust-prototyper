import { readFile, writeFile, createDir, bunInstallSync, runShellCommandSync, deleteDir } from "@/lib/ipc";
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
 * Flow:
 * 1. Save user's Generated.tsx if it exists.
 * 2. Remove the target directory so shadcn can create it fresh.
 * 3. Run `shadcn init -t vite --yes --name generated` (awaits completion).
 * 4. Add all shadcn components via `shadcn add --all` (awaits completion).
 * 5. Write our App.tsx and preview-theme.css.
 * 6. Restore Generated.tsx.
 * 7. Add icon library if selected.
 */
export async function scaffoldGenerated(
  generatedDir: string,
  iconLibrary: IconLibrary
): Promise<void> {
  const projectDir = generatedDir.substring(0, generatedDir.lastIndexOf("/"));
  const dirName = generatedDir.substring(generatedDir.lastIndexOf("/") + 1);
  assertSafeDirName(dirName);

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try {
    savedGenerated = await readFile(`${generatedDir}/${SRC.GENERATED_TSX}`);
  } catch {
    // Doesn't exist yet
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  await removeProjectDir(generatedDir);
  await createDir(projectDir);

  // Step 3: Run shadcn init — awaits completion
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Add all shadcn components — awaits completion (shadcn add runs bun install internally)
  await runShellCommandSync(generatedDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 5: Write our App.tsx (overwrites shadcn's placeholder)
  await writeFile(`${generatedDir}/${SRC.APP_TSX}`, getAppTsx());

  // Step 6: Write preview-theme.css (runtime theme overlay)
  await createDir(`${generatedDir}/${SRC.STYLES_DIR}`);
  await writeFile(`${generatedDir}/${SRC.PREVIEW_THEME_CSS}`, getPreviewThemeCss());

  // Step 7: Restore or create Generated.tsx
  await createDir(`${generatedDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${generatedDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(`${generatedDir}/${SRC.GENERATED_TSX}`, getGeneratedPlaceholderTsx());
  }

  // Step 8: Add icon library if selected
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg) {
    const pkgPath = `${generatedDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstallSync(generatedDir);
  }
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
  iconLibrary: IconLibrary
): Promise<void> {
  const projectDir = componentPreviewDir.substring(0, componentPreviewDir.lastIndexOf("/"));
  const dirName = componentPreviewDir.substring(componentPreviewDir.lastIndexOf("/") + 1);
  assertSafeDirName(dirName);

  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try {
    savedGenerated = await readFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`);
  } catch {
    // Doesn't exist yet
  }

  // Step 2: Remove the target directory so shadcn can create it fresh
  await removeProjectDir(componentPreviewDir);
  await createDir(projectDir);

  // Step 3: Run shadcn init — awaits completion
  await runShellCommandSync(projectDir, `${SHADCN_INIT_COMMAND} --name ${dirName}`);

  // Step 4: Add all shadcn components — awaits completion (shadcn add runs bun install internally)
  await runShellCommandSync(componentPreviewDir, `${SHADCN_ADD_COMMAND} --cwd .`);

  // Step 5: Write our App.tsx (overwrites shadcn's placeholder)
  await writeFile(`${componentPreviewDir}/${SRC.APP_TSX}`, getAppTsx());

  // Step 6: Write preview-theme.css (runtime theme overlay)
  await createDir(`${componentPreviewDir}/${SRC.STYLES_DIR}`);
  await writeFile(`${componentPreviewDir}/${SRC.PREVIEW_THEME_CSS}`, getPreviewThemeCss());

  // Step 7: Restore or create Generated.tsx
  await createDir(`${componentPreviewDir}/${SRC.COMPONENTS_DIR}`);
  if (savedGenerated) {
    await writeFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`, savedGenerated);
  } else {
    await writeFile(`${componentPreviewDir}/${SRC.GENERATED_TSX}`, getGeneratedPlaceholderTsx());
  }

  // Step 8: Add icon library if selected
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg) {
    const pkgPath = `${componentPreviewDir}/${P.PACKAGE_JSON}`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstallSync(componentPreviewDir);
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
 * Check if the generated/ directory has a valid shadcn scaffold.
 */
export async function hasGeneratedScaffold(projectDir: string): Promise<boolean> {
  return isScaffoldValid(getGeneratedDirPath(projectDir));
}

