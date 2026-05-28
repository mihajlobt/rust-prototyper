/**
 * E2E tests for theme generation.
 *
 * Each test:
 *  1. Calls minimax-m2.5 via Ollama cloud with the real theme system prompt
 *  2. Validates the CSS structure (required tokens, oklch values, no JSON wrapping)
 *  3. Writes to component-preview/src/styles/preview-theme.css
 *  4. Starts the Vite dev server — Tailwind v4 processes the theme CSS in dev mode,
 *     providing the same compilation coverage as a full build without the 120s cost
 *  5. Opens in Playwright, captures a screenshot showing the themed component
 *  6. Restores the original theme CSS after each test
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  generate,
  requireTestProjectDir,
  componentPreviewDir,
  startDevServer,
  captureRender,
  saveSnapshot,
  snapshotDir,
  restoreFile,
} from "./helpers";
import { getThemeSystemPrompt } from "@/lib/prompts/themes";

// ─── Setup ────────────────────────────────────────────────────────────────────

let projectDir: string;
let previewDir: string;
let generatedTsxPath: string;
let previewThemePath: string;
let originalThemeCss: string;

const CLEAN_GENERATED_PLACEHOLDER = `export default function Generated() {
  return <div style={{ padding: 24 }}>Generated component will appear here</div>;
}
`;

const BASE_PORT = 4400;
let portOffset = 0;

beforeAll(async () => {
  projectDir = await requireTestProjectDir();
  previewDir = componentPreviewDir(projectDir);
  previewThemePath = path.join(previewDir, "src", "styles", "preview-theme.css");
  generatedTsxPath = path.join(previewDir, "src", "components", "Generated.tsx");

  const tscBin = path.join(previewDir, "node_modules", ".bin", "tsc");
  await fs.access(tscBin).catch(() => {
    throw new Error(
      `component-preview is not scaffolded at ${previewDir}. ` +
        "Open the Prototyper app and scaffold the project first.",
    );
  });

  try {
    originalThemeCss = await fs.readFile(previewThemePath, "utf8");
  } catch {
    originalThemeCss = "";
  }

  // Write a clean placeholder so the dev server doesn't fail on stale generated code
  await fs.writeFile(generatedTsxPath, CLEAN_GENERATED_PLACEHOLDER, "utf8");
});

afterEach(async () => {
  await restoreFile(previewThemePath, originalThemeCss);
});

// ─── Validation helpers ───────────────────────────────────────────────────────

const REQUIRED_SHADCN_TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--primary",
  "--secondary",
  "--muted",
  "--border",
  "--input",
  "--ring",
  "--radius",
];

function assertShadcnTheme(css: string) {
  const hasRoot = /:root\s*{/.test(css);
  const hasDark = /\.dark\s*{/.test(css);
  expect(
    hasRoot || hasDark,
    "Theme must have at least a :root {} or .dark {} block",
  ).toBe(true);

  for (const token of REQUIRED_SHADCN_TOKENS) {
    expect(css, `Theme missing required token: ${token}`).toContain(token);
  }

  const varLines = css.split("\n").filter((l) => l.includes("--") && l.includes(":"));
  const badLines = varLines.filter(
    (l) => /#[0-9a-fA-F]{3,6}/.test(l) || /\brgb\(/.test(l) || /\bhsl\(/.test(l),
  );
  expect(
    badLines,
    `Theme uses legacy color formats instead of oklch():\n${badLines.join("\n")}`,
  ).toHaveLength(0);

  expect(css.trimStart(), "Theme must not be JSON-wrapped").not.toMatch(/^\{/);
}

async function generateWriteAndValidate(
  testLabel: string,
  userPrompt: string,
  systemPrompt: string,
  extraAssert?: (css: string) => void,
) {
  const { primaryContent } = await generate(systemPrompt, userPrompt);
  expect(primaryContent, "Model did not call write_file — no CSS produced").not.toBeNull();

  assertShadcnTheme(primaryContent!);
  extraAssert?.(primaryContent!);

  await fs.writeFile(previewThemePath, primaryContent!, "utf8");

  const port = BASE_PORT + portOffset++;
  const server = await startDevServer(previewDir, port);
  try {
    const { screenshot, consoleErrors, hasRootContent } = await captureRender(server.url);

    const errors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("DevTools"),
    );
    expect(errors, `React errors with theme applied:\n${errors.join("\n")}`).toHaveLength(0);
    expect(hasRootContent, "React root rendered empty with theme applied").toBe(true);
    // nonWhiteRatio is not checked for themes — the background color is determined by
    // the generated CSS (white background themes legitimately have near-zero non-white ratio).
    // assertShadcnTheme() + no console errors + hasRootContent cover correctness.

    const snapshotPath = await saveSnapshot(testLabel, screenshot, snapshotDir());
    console.log(`  snapshot: ${snapshotPath}`);
  } finally {
    server.stop();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("theme generation E2E", () => {
  it(
    "generates a dark ocean theme with all required tokens and renders",
    async () => {
      await generateWriteAndValidate(
        "theme-dark-ocean",
        "Create a dark ocean theme: deep navy background, teal primary, slate card surfaces, subtle cyan accents. Dark mode only.",
        getThemeSystemPrompt("shadcn"),
      );
    },
    120_000,
  );

  it(
    "generates a warm earthy theme with light and dark modes and renders",
    async () => {
      await generateWriteAndValidate(
        "theme-warm-earthy",
        "Create a warm earthy theme with both light and dark modes: warm beige background in light, deep brown in dark, terracotta primary, olive accent. Include both :root and .dark blocks.",
        getThemeSystemPrompt("shadcn"),
        (css) => {
          expect(css, "Warm earthy theme should include .dark block").toMatch(/\.dark\s*{/);
        },
      );
    },
    120_000,
  );

  it(
    "generates a high-contrast accessibility theme and renders",
    async () => {
      await generateWriteAndValidate(
        "theme-high-contrast",
        "Create a high-contrast accessibility theme: pure white background, near-black foreground (maximum contrast), bright blue primary, visible borders. Suitable for users with low vision.",
        getThemeSystemPrompt("shadcn"),
      );
    },
    120_000,
  );
});
