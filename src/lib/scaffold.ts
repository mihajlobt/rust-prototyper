import { readFile, writeFile, createDir, bunInstall, runShellCommand, deleteFile, deleteDir, readDir } from "@/lib/ipc";
import { ICON_LIBRARY_PACKAGES } from "@/lib/prompts";
import type { IconLibrary } from "@/lib/prompts";

/**
 * Check if the generated/ folder has a Vite project scaffold.
 */
export async function hasViteScaffold(generatedDir: string): Promise<boolean> {
  try {
    await readFile(`${generatedDir}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively delete all files and directories inside `dir`,
 * but keep the `dir` itself.
 *
 * Throws if any entry cannot be deleted.
 */
async function clearDirectory(dir: string): Promise<void> {
  let entries: Awaited<ReturnType<typeof readDir>>;
  try {
    entries = await readDir(dir);
  } catch {
    // Directory doesn't exist yet — nothing to clear
    return;
  }

  for (const entry of entries) {
    const path = `${dir}/${entry.name}`;
    if (entry.is_dir) {
      await deleteDir(path);
    } else {
      await deleteFile(path);
    }
  }

  // Verify the directory is actually empty
  const remaining = await readDir(dir);
  if (remaining.length > 0) {
    throw new Error(
      `Failed to clear ${dir}. Remaining entries: ${remaining.map((e) => e.name).join(", ")}`
    );
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
 * Scaffold a React + TypeScript + Vite project in the generated/ folder.
 *
 * Flow:
 * 1. Save user's Generated.tsx if it exists.
 * 2. Clear the generated/ directory so bun create sees an empty dir.
 * 3. Run `bun create vite . --template react-ts`.
 * 4. Wait for package.json to appear (runShellCommand returns immediately).
 * 5. Install dependencies.
 * 6. Restore Generated.tsx.
 * 7. Add icon library and run `bun install`.
 */
export async function scaffoldGenerated(
  generatedDir: string,
  iconLibrary: IconLibrary
): Promise<void> {
  // Step 1: Save user's Generated.tsx if it exists
  let savedGenerated = "";
  try {
    savedGenerated = await readFile(`${generatedDir}/src/components/Generated.tsx`);
  } catch {
    // Doesn't exist yet
  }

  // Step 2: Clear the directory so bun create sees an empty dir
  await clearDirectory(generatedDir);

  // Step 3: Scaffold into the now-empty directory
  await runShellCommand(generatedDir, "bun create vite . --template react-ts");

  // Step 4: Wait for package.json to appear (runShellCommand spawns async)
  await waitForFile(`${generatedDir}/package.json`);

  // Step 5: Install dependencies
  await bunInstall(generatedDir);
  await waitForFile(`${generatedDir}/node_modules/vite/package.json`);

  // Step 6: Restore Generated.tsx
  await createDir(`${generatedDir}/src/components`);
  if (savedGenerated) {
    await writeFile(`${generatedDir}/src/components/Generated.tsx`, savedGenerated);
  } else {
    // Create a placeholder so the app doesn't crash on first run
    await writeFile(
      `${generatedDir}/src/components/Generated.tsx`,
      `export default function Generated() {\n  return <div style={{ padding: 24 }}>Generated component will appear here</div>;\n}\n`
    );
  }

  // Step 7: Add icon library if selected
  const iconPkg = ICON_LIBRARY_PACKAGES[iconLibrary];
  if (iconPkg) {
    const pkgPath = `${generatedDir}/package.json`;
    const pkgRaw = await readFile(pkgPath);
    const pkg = JSON.parse(pkgRaw) as Record<string, unknown>;
    const deps = (pkg.dependencies as Record<string, string>) || {};
    deps[iconPkg] = "latest";
    pkg.dependencies = deps;
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    await bunInstall(generatedDir);
    await waitForFile(`${generatedDir}/node_modules/vite/package.json`);
  }
}
