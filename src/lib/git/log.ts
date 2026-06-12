import { runShellCommandCapture } from "@/lib/ipc";
import type { GitCommit } from "./types";

const FIELD_SEP = "\x1f";
const RECORD_SEP = "\x1e";

export async function getLog(cwd: string, limit = 50): Promise<GitCommit[]> {
  const format = `%H${FIELD_SEP}%h${FIELD_SEP}%an${FIELD_SEP}%aI${FIELD_SEP}%s${RECORD_SEP}`;
  const output = await runShellCommandCapture(cwd, `git log -n ${limit} --pretty=format:${format}`);

  return output
    .split(RECORD_SEP)
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, author, date, subject] = record.split(FIELD_SEP);
      return { hash, shortHash, author, date, subject };
    });
}

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 60 * 60 * 24 * 365],
  ["month", 60 * 60 * 24 * 30],
  ["day", 60 * 60 * 24],
  ["hour", 60 * 60],
  ["minute", 60],
  ["second", 1],
];

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelativeDate(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, secondsInUnit] of UNITS) {
    if (Math.abs(seconds) >= secondsInUnit || unit === "second") {
      return rtf.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return rtf.format(0, "second");
}
