/**
 * E2E tests for component generation.
 *
 * Each test:
 *  1. Calls minimax-m2.5 via Ollama cloud with the real system prompt
 *  2. Passes real tsc/lint/build output back to the model so self-correction is exercised
 *  3. Writes generated code to component-preview/src/components/Generated.tsx
 *  4. Runs tsc, eslint, and esbuild on the final output
 *  5. Starts the Vite dev server, opens in Playwright, captures a screenshot
 *  6. Asserts: no React console errors, root has content, expected DOM elements present,
 *     screenshot is non-blank
 *  7. Saves the screenshot as an artifact and restores the original Generated.tsx
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type GenerationToolContext,
  generate,
  resolveExtraFileDests,
  requireTestProjectDir,
  componentPreviewDir,
  runFileTypecheck,
  runFileBuild,
  runLint,
  filterLintOutput,
  startDevServer,
  captureRender,
  analyzeScreenshot,
  saveSnapshot,
  snapshotDir,
  restoreFile,
} from "./helpers";
import {
  getComponentNewPrompt,
  getComponentUpdatePrompt,
  COMPONENT_NEW_PROMPT_SHADCN,
} from "@/lib/prompts/components";
import { outputFilePathSection } from "@/lib/prompts/shared";

// ─── Setup ────────────────────────────────────────────────────────────────────

let projectDir: string;
let appDataDir: string;
let previewDir: string;
let generatedTsxPath: string;
let originalGeneratedTsx: string;
let writtenExtras: string[] = [];

const BASE_PORT = 4200;
let portOffset = 0;

beforeAll(async () => {
  projectDir = await requireTestProjectDir();
  appDataDir = path.join(projectDir, "..", "..");
  previewDir = componentPreviewDir(projectDir);
  generatedTsxPath = path.join(previewDir, "src", "components", "Generated.tsx");

  const tscBin = path.join(previewDir, "node_modules", ".bin", "tsc");
  await fs.access(tscBin).catch(() => {
    throw new Error(
      `component-preview is not scaffolded at ${previewDir}. ` +
        "Open the Prototyper app and scaffold the project first.",
    );
  });

  originalGeneratedTsx = await fs.readFile(generatedTsxPath, "utf8");
});

afterEach(async () => {
  await restoreFile(generatedTsxPath, originalGeneratedTsx);
  await Promise.all(
    writtenExtras
      .filter((p) => p !== generatedTsxPath)
      .map((p) => fs.rm(p, { force: true })),
  );
  writtenExtras = [];
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fakeOutputPath(projectId: string) {
  return `projects/${projectId}/component-preview/src/components/Generated.tsx`;
}

const TOOL_CONTEXT: GenerationToolContext = {
  get previewDir() {
    return previewDir;
  },
  primaryRelPath: "src/components/Generated.tsx",
};

async function generateWriteAndValidate(
  testLabel: string,
  userPrompt: string,
  systemPrompt: string,
  expectedSelectors: string[] = [],
) {
  const { primaryContent, assistantText, extraFiles } = await generate(
    systemPrompt,
    userPrompt,
    12,
    TOOL_CONTEXT,
  );
  expect(
    primaryContent,
    `Model produced no code. Response preview: ${assistantText.slice(0, 400)}`,
  ).not.toBeNull();

  for (const [relPath, content] of Object.entries(extraFiles)) {
    if (content === primaryContent) continue;
    for (const dest of resolveExtraFileDests(relPath, appDataDir, projectDir, previewDir)) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, content, "utf8");
      writtenExtras.push(dest);
    }
  }

  await fs.writeFile(generatedTsxPath, primaryContent!, "utf8");

  const tscOut = runFileTypecheck(previewDir, "src/components/Generated.tsx");
  expect(tscOut, `TypeScript errors in generated component:\n${tscOut}`).toBe("");

  const lintOut = filterLintOutput(runLint(previewDir, "src/components/Generated.tsx"));
  expect(lintOut, `ESLint errors in generated component:\n${lintOut}`).toBe("");

  runFileBuild(previewDir, "src/components/Generated.tsx");

  const port = BASE_PORT + portOffset++;
  const server = await startDevServer(previewDir, port);
  try {
    const { screenshot, consoleErrors, hasRootContent, missingSelectors } =
      await captureRender(server.url, expectedSelectors);

    const errors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("DevTools"),
    );
    expect(errors, `React console errors during render:\n${errors.join("\n")}`).toHaveLength(0);
    expect(hasRootContent, "React root rendered empty content").toBe(true);

    expect(
      missingSelectors,
      `Generated component missing expected DOM elements:\n${missingSelectors.join("\n")}`,
    ).toHaveLength(0);

    const { nonWhiteRatio } = analyzeScreenshot(screenshot);
    expect(
      nonWhiteRatio,
      `Screenshot for "${testLabel}" appears blank (${(nonWhiteRatio * 100).toFixed(1)}% non-white pixels)`,
    ).toBeGreaterThan(0.05);

    const snapshotPath = await saveSnapshot(testLabel, screenshot, snapshotDir());
    console.log(`  snapshot: ${snapshotPath}`);
  } finally {
    server.stop();
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("component generation E2E", () => {
  it(
    "generates a product card with no type, lint, or build errors and renders",
    async () => {
      const projectId = path.basename(projectDir);
      await generateWriteAndValidate(
        "component-product-card",
        "Build a product card with an image placeholder, title, price, star rating (4.2 out of 5), and an add-to-cart button.",
        getComponentNewPrompt("lucide", true) + outputFilePathSection(fakeOutputPath(projectId)),
        ["button"],
      );
    },
    180_000,
  );

  it(
    "generates a login form with no type, lint, or build errors and renders",
    async () => {
      const projectId = path.basename(projectDir);
      await generateWriteAndValidate(
        "component-login-form",
        "Build a login form with email and password fields, show/hide password toggle, remember me checkbox, and a submit button.",
        getComponentNewPrompt("lucide", true) + outputFilePathSection(fakeOutputPath(projectId)),
        ["input", "button"],
      );
    },
    180_000,
  );

  it(
    "generates KPI stat cards with no type, lint, or build errors and renders",
    async () => {
      const projectId = path.basename(projectDir);
      await generateWriteAndValidate(
        "component-kpi-cards",
        "Build a row of 4 KPI stat cards: Total Revenue ($48,295), Active Users (1,204), New Signups (89), Churn Rate (2.1%). Each card has a trend arrow and percentage change.",
        getComponentNewPrompt("lucide", true) + outputFilePathSection(fakeOutputPath(projectId)),
      );
    },
    180_000,
  );

  it(
    "generates a notification dropdown with no type, lint, or build errors and renders",
    async () => {
      const projectId = path.basename(projectDir);
      await generateWriteAndValidate(
        "component-notification-dropdown",
        "Build a notification bell icon with badge showing unread count. Clicking opens a dropdown with 3 notifications (each has icon, title, message, and timestamp). Mark all as read button at bottom.",
        COMPONENT_NEW_PROMPT_SHADCN + outputFilePathSection(fakeOutputPath(projectId)),
        ["button"],
      );
    },
    180_000,
  );

  it(
    "generates a data table with no type, lint, or build errors and renders",
    async () => {
      const projectId = path.basename(projectDir);
      await generateWriteAndValidate(
        "component-data-table",
        "Build a users data table with 5 rows. Columns: Name, Email, Role (badge), Status (Active/Inactive badge), and Actions (Edit/Delete icon buttons).",
        getComponentNewPrompt("lucide", true) + outputFilePathSection(fakeOutputPath(projectId)),
        ["table, [role='table']"],
      );
    },
    180_000,
  );

  it(
    "edits a generated component and produces valid code with all checks passing",
    async () => {
      const projectId = path.basename(projectDir);

      // Step 1: Generate an initial component
      const newPrompt =
        getComponentNewPrompt("lucide", true) + outputFilePathSection(fakeOutputPath(projectId));
      const initial = await generate(
        newPrompt,
        "Build a simple counter with a +1 button and a displayed count starting at 0.",
        12,
        TOOL_CONTEXT,
      );
      expect(
        initial.primaryContent,
        `Initial generation produced no code. Response: ${initial.assistantText.slice(0, 400)}`,
      ).not.toBeNull();
      await fs.writeFile(generatedTsxPath, initial.primaryContent!, "utf8");

      // Step 2: Edit — add a reset button using the real update prompt with existing code
      const updatePrompt =
        getComponentUpdatePrompt("lucide", initial.primaryContent!, true) +
        outputFilePathSection(fakeOutputPath(projectId));
      const edited = await generate(
        updatePrompt,
        "Add a Reset button that sets the count back to zero.",
        12,
        TOOL_CONTEXT,
      );
      expect(
        edited.primaryContent,
        `Edit produced no code. Response: ${edited.assistantText.slice(0, 400)}`,
      ).not.toBeNull();

      await fs.writeFile(generatedTsxPath, edited.primaryContent!, "utf8");

      const tscOut = runFileTypecheck(previewDir, "src/components/Generated.tsx");
      expect(tscOut, `TypeScript errors after edit:\n${tscOut}`).toBe("");

      const lintOut = filterLintOutput(runLint(previewDir, "src/components/Generated.tsx"));
      expect(lintOut, `ESLint errors after edit:\n${lintOut}`).toBe("");

      runFileBuild(previewDir, "src/components/Generated.tsx");

      const port = BASE_PORT + portOffset++;
      const server = await startDevServer(previewDir, port);
      try {
        const { screenshot, consoleErrors, hasRootContent, missingSelectors } =
          await captureRender(server.url, ["button"]);

        const errors = consoleErrors.filter(
          (e) => !e.includes("favicon") && !e.includes("DevTools"),
        );
        expect(errors, `React errors in edited component:\n${errors.join("\n")}`).toHaveLength(0);
        expect(hasRootContent, "Edited component rendered empty").toBe(true);
        expect(
          missingSelectors,
          `Edited component missing expected elements:\n${missingSelectors.join("\n")}`,
        ).toHaveLength(0);

        const { nonWhiteRatio } = analyzeScreenshot(screenshot);
        expect(nonWhiteRatio, "Edited component screenshot appears blank").toBeGreaterThan(0.05);

        await saveSnapshot("component-edit-counter-reset", screenshot, snapshotDir());
      } finally {
        server.stop();
      }
    },
    300_000,
  );
});
