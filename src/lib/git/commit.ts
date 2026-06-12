import { runShellCommandCapture, writeFile, deleteFile } from "@/lib/ipc";
import { detectGitError } from "./errors";

const COMMIT_MSG_FILE = ".prototyper-commit-msg.tmp";

/**
 * Commits staged changes with `message`. The message is written to a temp
 * file and passed via `git commit -F` to avoid shell-quoting issues with
 * quotes/newlines in `runShellCommandCapture`'s shlex-based command parsing.
 */
export async function commit(cwd: string, message: string): Promise<void> {
  const tmpPath = `${cwd}/${COMMIT_MSG_FILE}`;
  try {
    await writeFile(tmpPath, message);
    const output = await runShellCommandCapture(cwd, `git commit -F ${COMMIT_MSG_FILE}`);
    if (output.includes("nothing to commit")) {
      throw new Error("Nothing to commit.");
    }
    const error = detectGitError(output);
    if (error) throw new Error(error);
  } finally {
    await deleteFile(tmpPath).catch(() => {});
  }
}
