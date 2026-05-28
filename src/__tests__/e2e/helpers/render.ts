import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type Page } from "@playwright/test";
import { PNG } from "pngjs";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreviewServer {
  url: string;
  stop: () => void;
}

export interface RenderResult {
  screenshot: Buffer;
  consoleErrors: string[];
  hasRootContent: boolean;
  missingSelectors: string[];
}

// ─── Dev server ───────────────────────────────────────────────────────────────

/**
 * Start a Vite dev server. Waits for "Local:" in stdout — the line Vite emits
 * once the server is ready — instead of polling HTTP, which races hydration.
 */
export async function startDevServer(
  previewDir: string,
  port = 5173,
  timeoutMs = 30_000,
): Promise<PreviewServer> {
  const proc: ChildProcess = spawn(
    "bun",
    ["run", "dev", "--", "--port", String(port), "--strictPort"],
    { cwd: previewDir, stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = `http://localhost:${port}`;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(`Vite dev server did not start within ${timeoutMs}ms on port ${port}`),
        ),
      timeoutMs,
    );

    const onData = (chunk: Buffer) => {
      const text = chunk.toString();
      if (text.includes("Local:") || text.includes("ready in")) {
        clearTimeout(timer);
        resolve();
      }
    };

    proc.stdout?.on("data", onData);
    // Vite sometimes routes startup text through stderr on certain platforms
    proc.stderr?.on("data", onData);

    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Vite process error: ${err.message}`));
    });

    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0 && code !== null) {
        reject(new Error(`Vite process exited with code ${code} before becoming ready`));
      }
    });
  });

  return { url, stop: () => proc.kill("SIGTERM") };
}

export async function startPreviewServer(
  previewDir: string,
  port = 4173,
  timeoutMs = 30_000,
): Promise<PreviewServer> {
  const proc: ChildProcess = spawn(
    "bun",
    ["run", "preview", "--", "--port", String(port), "--strictPort"],
    { cwd: previewDir, stdio: ["ignore", "pipe", "pipe"] },
  );

  const url = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;

  // Poll HTTP until the static preview server responds — more reliable than
  // parsing stdout since bun echoes the script name early and "Local:" can
  // appear before the port is bound.
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (res.ok || res.status < 500) break;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  if (Date.now() >= deadline) {
    proc.kill("SIGTERM");
    throw new Error(`Vite preview server did not start within ${timeoutMs}ms on port ${port}`);
  }

  return { url, stop: () => proc.kill("SIGTERM") };
}

// ─── Browser capture ──────────────────────────────────────────────────────────

/**
 * Opens the preview URL in headless Chromium, waits for the React root to render,
 * captures a screenshot, and checks that each expected CSS selector has at least one match.
 */
export async function captureRender(
  url: string,
  expectedSelectors: string[] = [],
): Promise<RenderResult> {
  let browser: Browser | null = null;
  let page: Page | null = null;
  const consoleErrors: string[] = [];

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(`[uncaught] ${err.message}`));

    await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });

    let timedOut = false;
    try {
      await page.waitForFunction(
        () => {
          const root = document.getElementById("root");
          return root && root.children.length > 0;
        },
        { timeout: 10_000 },
      );
    } catch {
      timedOut = true;
    }

    const screenshot = await page.screenshot({ fullPage: true });

    const hasRootContent = await page.evaluate(() => {
      const root = document.getElementById("root");
      return !!root && root.innerHTML.trim().length > 0;
    });

    if (timedOut && consoleErrors.length === 0) {
      const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
      if (bodyText.trim()) {
        consoleErrors.push(`[render-timeout] Page content: ${bodyText.slice(0, 300)}`);
      }
    }

    // Verify each expected selector has at least one match in the rendered DOM
    const missingSelectors: string[] = [];
    for (const selector of expectedSelectors) {
      const count = await page.locator(selector).count();
      if (count === 0) missingSelectors.push(selector);
    }

    return { screenshot, consoleErrors, hasRootContent, missingSelectors };
  } finally {
    await page?.close();
    await browser?.close();
  }
}

// ─── Screenshot utilities ─────────────────────────────────────────────────────

/** Decode the PNG buffer and return the ratio of non-white pixels. Catches blank renders. */
export function analyzeScreenshot(screenshot: Buffer): { nonWhiteRatio: number } {
  const png = PNG.sync.read(screenshot);
  const totalPixels = png.width * png.height;
  let nonWhitePixels = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r < 245 || g < 245 || b < 245) nonWhitePixels++;
  }
  return { nonWhiteRatio: nonWhitePixels / totalPixels };
}

/** Save a screenshot as a test artifact. */
export async function saveSnapshot(
  testName: string,
  screenshot: Buffer,
  dir: string,
): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const filename = `${testName.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.png`;
  const fullPath = path.join(dir, filename);
  await fs.writeFile(fullPath, screenshot);
  return fullPath;
}

export function snapshotDir(): string {
  return path.join(import.meta.dirname, "..", "__snapshots__");
}

export async function restoreFile(filePath: string, original: string): Promise<void> {
  await fs.writeFile(filePath, original, "utf8");
}
