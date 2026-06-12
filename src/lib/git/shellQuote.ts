/**
 * Quote a file path for safe inclusion in a command string passed to
 * `runShellCommandCapture`, which splits the command with `shlex::split`
 * (POSIX shell quoting rules) before invoking git directly (no real shell).
 */
export function quotePath(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}
