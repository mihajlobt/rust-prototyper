export interface StatusInfo {
  label: string;
  badge: string;
  colorClass: string;
}

const STATUS_INFO: Record<string, StatusInfo> = {
  M: { label: "Modified", badge: "M", colorClass: "text-amber-500" },
  A: { label: "Added", badge: "A", colorClass: "text-green-500" },
  D: { label: "Deleted", badge: "D", colorClass: "text-red-500" },
  R: { label: "Renamed", badge: "R", colorClass: "text-violet-500" },
  C: { label: "Copied", badge: "C", colorClass: "text-violet-500" },
  U: { label: "Conflict", badge: "U", colorClass: "text-red-500" },
};

const UNTRACKED_INFO: StatusInfo = { label: "Untracked", badge: "U", colorClass: "text-green-500" };

/** Maps a porcelain v2 status code (M/A/D/R/C/U or "?" for untracked) to a display label/badge/color. */
export function getStatusInfo(code: string): StatusInfo {
  if (code === "?") return UNTRACKED_INFO;
  return STATUS_INFO[code] ?? { label: code, badge: code, colorClass: "text-muted-foreground" };
}
