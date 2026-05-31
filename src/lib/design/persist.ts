/**
 * Orchestration + persistence for design languages.
 *
 * A design language lives inside the existing themes/{name}/ folder so every current
 * consumer (stylePreset, preview-theme.css copy, token extraction, sidebar) keeps working:
 *   design.json  — the structured spec (source of truth)
 *   theme.css    — rendered tokens (what the rest of the app already reads)
 *   DESIGN.md    — rendered brief (injected into screen/component generation)
 *   tokens.json  — rendered DTCG export
 */

import { readFile, writeFile, createDir, isNotFoundError } from "@/lib/ipc";
import { designLanguageSpecSchema, type DesignLanguageSpec } from "./spec";
import { renderThemeCss, renderDesignMd, renderTokensJson } from "./render";

const DESIGN_JSON = "design.json";
const THEME_CSS = "theme.css";
const DESIGN_MD = "DESIGN.md";
const TOKENS_JSON = "tokens.json";

/** Absolute (app-data-relative) directory for a design language / theme. */
function designDir(projectDir: string, name: string): string {
  return `${projectDir}/themes/${name}`;
}

/** Write the full rendered bundle for a spec. Returns the rendered theme.css. */
export async function persistDesignLanguage(
  projectDir: string,
  name: string,
  spec: DesignLanguageSpec,
): Promise<{ css: string; md: string }> {
  const dir = designDir(projectDir, name);
  await createDir(dir);
  const css = renderThemeCss(spec);
  const md = renderDesignMd(spec);
  await writeFile(`${dir}/${DESIGN_JSON}`, JSON.stringify(spec, null, 2));
  await writeFile(`${dir}/${THEME_CSS}`, css);
  await writeFile(`${dir}/${DESIGN_MD}`, md);
  await writeFile(`${dir}/${TOKENS_JSON}`, renderTokensJson(spec));
  return { css, md };
}

/** Read a persisted spec, or null if this theme is a legacy CSS-only theme (no design.json). */
export async function loadDesignSpec(projectDir: string, name: string): Promise<DesignLanguageSpec | null> {
  try {
    const raw = await readFile(`${designDir(projectDir, name)}/${DESIGN_JSON}`);
    const result = designLanguageSpecSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch (e) {
    if (isNotFoundError(e)) return null;
    throw e;
  }
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
