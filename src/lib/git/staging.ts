import { runShellCommandCapture, deleteFile } from "@/lib/ipc";
import { quotePath } from "./shellQuote";

export async function stageFile(cwd: string, path: string): Promise<void> {
  await runShellCommandCapture(cwd, `git add -- ${quotePath(path)}`);
}

export async function stageAll(cwd: string): Promise<void> {
  await runShellCommandCapture(cwd, "git add -A");
}

export async function unstageFile(cwd: string, path: string): Promise<void> {
  await runShellCommandCapture(cwd, `git restore --staged -- ${quotePath(path)}`);
}

export async function unstageAll(cwd: string): Promise<void> {
  await runShellCommandCapture(cwd, "git restore --staged .");
}

/**
 * Discards working-tree changes to a file. Tracked files are reverted to
 * their checked-in/staged content; untracked files are deleted from disk.
 */
export async function discardFile(cwd: string, path: string, isUntracked: boolean): Promise<void> {
  if (isUntracked) {
    await deleteFile(`${cwd}/${path}`);
    return;
  }
  await runShellCommandCapture(cwd, `git checkout -- ${quotePath(path)}`);
}
