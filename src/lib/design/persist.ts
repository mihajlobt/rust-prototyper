/**
 * Persistence helpers for design languages.
 *
 * A design language lives inside the existing themes/{name}/ folder:
 *   design.json  — the structured spec (source of truth)
 *   theme.css    — CSS custom properties (what the rest of the app reads)
 *   DESIGN.md    — human-readable design brief (injected into screen/component generation)
 */

import { readFile, isNotFoundError } from "@/lib/ipc";

const DESIGN_MD = "DESIGN.md";

/** Absolute (app-data-relative) directory for a design language / theme. */
function designDir(projectDir: string, name: string): string {
  return `${projectDir}/themes/${name}`;
}

/** Read a design language's DESIGN.md brief, or null if absent (legacy theme). */
export async function loadDesignBrief(projectDir: string, name: string): Promise<string | null> {
  try {
    return await readFile(`${designDir(projectDir, name)}/${DESIGN_MD}`);
  } catch (e) {
    if (isNotFoundError(e)) return null;
    throw e;
  }
}
