import { runShellCommandCapture } from "@/lib/ipc";
import { detectGitError } from "./errors";

export { detectGitError };

export async function gitFetch(cwd: string): Promise<string> {
  const output = await runShellCommandCapture(cwd, "git fetch");
  const error = detectGitError(output);
  if (error) throw new Error(error);
  return output;
}

export async function gitPull(cwd: string): Promise<string> {
  const output = await runShellCommandCapture(cwd, "git pull");
  const error = detectGitError(output);
  if (error) throw new Error(error);
  return output;
}

export async function gitPush(cwd: string): Promise<string> {
  const output = await runShellCommandCapture(cwd, "git push");
  const error = detectGitError(output);
  if (error) throw new Error(error);
  return output;
}

/** Fetch, pull, then push — mirrors VS Code's "Sync Changes" action. */
export async function gitSync(cwd: string): Promise<void> {
  await gitFetch(cwd);
  await gitPull(cwd);
  await gitPush(cwd);
}
