/**
 * `runShellCommandCapture` never throws on a non-zero exit code — it returns
 * combined stdout+stderr regardless. Scan that output for common git error
 * patterns so callers can surface a human-readable message via a toast.
 */
const ERROR_PATTERNS = [
  /fatal:.*/i,
  /error:.*/i,
  /CONFLICT.*/,
  /Authentication failed.*/i,
  /Permission denied.*/i,
  /.*rejected.*/,
];

export function detectGitError(output: string): string | null {
  for (const pattern of ERROR_PATTERNS) {
    const match = output.match(pattern);
    if (match) return match[0].trim();
  }
  return null;
}
