import { runShellCommandCapture, readFile, writeFile } from "@/lib/ipc";

/** Git operates on the generated app directory, not the Prototyper project metadata folder. */
export function gitCwd(project: string): string {
  return `projects/${project}/generated`;
}

export const DEFAULT_GITIGNORE = `node_modules/
dist/
.DS_Store
*.log
`;

/** True if `cwd` is inside a git working tree. */
export async function isGitRepo(cwd: string): Promise<boolean> {
  const output = await runShellCommandCapture(cwd, "git rev-parse --is-inside-work-tree");
  return output.trim() === "true";
}

/** Initializes a git repo at `cwd` and writes a `.gitignore` if one doesn't exist. */
export async function initRepo(cwd: string): Promise<void> {
  await runShellCommandCapture(cwd, "git init");

  // The agent's sandboxed bash tool runs with HOME pointed at the app data dir, so it
  // never sees the user's global ~/.gitconfig. Set a local identity so `git commit`
  // works from both the unsandboxed UI and the sandboxed agent.
  await runShellCommandCapture(cwd, "git config user.name Prototyper");
  await runShellCommandCapture(cwd, "git config user.email prototyper@local");

  const gitignorePath = `${cwd}/.gitignore`;
  const exists = await readFile(gitignorePath).then(() => true).catch(() => false);
  if (!exists) {
    await writeFile(gitignorePath, DEFAULT_GITIGNORE);
  }
}
