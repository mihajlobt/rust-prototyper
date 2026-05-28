import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function runTypecheck(previewDir: string): string {
  try {
    execSync("bun run typecheck", { cwd: previewDir, stdio: "pipe", timeout: 60_000 });
    return "";
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return ((e.stdout?.toString() ?? "") + "\n" + (e.stderr?.toString() ?? "")).trim();
  }
}

export function runLint(previewDir: string, filePath: string): string {
  try {
    execSync(`bunx eslint ${JSON.stringify(filePath)}`, {
      cwd: previewDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    return "";
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return ((e.stdout?.toString() ?? "") + "\n" + (e.stderr?.toString() ?? "")).trim();
  }
}

/**
 * Filter lint output to only include errors that indicate functional bugs.
 * Style-only rules are excluded: they don't affect runtime behaviour and AI models
 * generate them frequently without being able to reliably self-correct them.
 */
export function filterLintOutput(output: string): string {
  const IGNORABLE = [
    // Unused vars/imports — common in AI-generated code, no runtime effect
    /@typescript-eslint\/no-unused-vars/,
    /no-unused-vars/,
    // prefer-const — stylistic only, auto-fixable, no runtime effect
    /prefer-const/,
  ];
  const lines = output.split("\n");
  const filtered = lines.filter((line) => !IGNORABLE.some((r) => r.test(line)));
  const errorLines = filtered.filter(
    (l) => /error\s+'.+'/.test(l) || /^\s+\d+:\d+\s+error/.test(l),
  );
  if (errorLines.length === 0) return "";
  return filtered.join("\n").trim();
}

export function runBuild(previewDir: string): void {
  try {
    execSync("bun run build", { cwd: previewDir, stdio: "pipe", timeout: 120_000 });
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = (e.stdout?.toString() ?? "") + "\n" + (e.stderr?.toString() ?? "");
    throw new Error(`Build failed in ${path.basename(previewDir)}:\n${out.trim()}`, { cause: err });
  }
}

/**
 * Run TypeScript check on a single file via a per-file tsconfig.
 * Avoids false positives from broken files elsewhere in the same project.
 */
export function runFileTypecheck(previewDir: string, relFilePath: string): string {
  const tsconfigContent = JSON.stringify(
    {
      extends: "./tsconfig.app.json",
      compilerOptions: {
        noUnusedLocals: false,
        noUnusedParameters: false,
        // esbuild (used by Vite) processes files in isolation and CANNOT erase implicit
        // type-only imports — it has no type information. However, any resulting runtime
        // error ("does not provide an export named X") surfaces as a pageerror event in
        // captureRender and is caught by the consoleErrors assertion there.
        // Keeping this false prevents TS1484 loops where the model cannot self-correct
        // the `import type` syntax within the allowed tool rounds.
        verbatimModuleSyntax: false,
      },
      include: [relFilePath],
      exclude: ["node_modules"],
    },
    null,
    2,
  );

  const tsconfigPath = path.join(previewDir, "tsconfig.e2e-test.json");
  fs.writeFileSync(tsconfigPath, tsconfigContent, "utf8");

  try {
    execSync("bun run tsc --noEmit --project tsconfig.e2e-test.json", {
      cwd: previewDir,
      stdio: "pipe",
      timeout: 60_000,
    });
    return "";
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    return ((e.stdout?.toString() ?? "") + "\n" + (e.stderr?.toString() ?? "")).trim();
  } finally {
    try {
      fs.unlinkSync(tsconfigPath);
    } catch {
      // ignore
    }
  }
}

/** Quick esbuild check on a single file — catches JSX/syntax errors without a full Vite build. */
export function runFileBuild(previewDir: string, relFilePath: string): void {
  try {
    execSync(
      `bunx esbuild ${JSON.stringify(relFilePath)} --jsx=automatic --loader:.tsx=tsx`,
      { cwd: previewDir, stdio: "pipe", timeout: 60_000 },
    );
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; stderr?: Buffer };
    const out = (e.stdout?.toString() ?? "") + "\n" + (e.stderr?.toString() ?? "");
    throw new Error(`Build failed for ${relFilePath}:\n${out.trim()}`, { cause: err });
  }
}
