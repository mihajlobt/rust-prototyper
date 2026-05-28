/**
 * Tauri native IPC smoke tests.
 *
 * These tests run against the compiled Tauri binary via @crabnebula/tauri-driver
 * and exercise the Rust↔TypeScript IPC boundary that the Vitest/Playwright suite
 * cannot reach (it runs against Vite dev server only).
 *
 * Run with:  bun test:tauri
 * Requires:  bun tauri build  (must have a compiled binary at src-tauri/target/release/prototyper)
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { browser, $ } from "@wdio/globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BINARY_PATH = path.join(
  __dirname,
  "../../../src-tauri/target/release/prototyper",
);

// Skip the entire suite if the binary hasn't been built yet.
// This avoids CI failures on machines that only run the Vite dev tests.
const SKIP = !existsSync(BINARY_PATH);
const maybe = SKIP ? describe.skip : describe;

maybe("Tauri app IPC smoke tests", () => {
  it("launches and the main window has a title", async () => {
    const title = await browser.getTitle();
    expect(title).toBeTruthy();
  });

  it("the React root mounts within 5 seconds", async () => {
    const root = await $("#root");
    await root.waitForExist({ timeout: 5_000 });
    const html = await root.getHTML();
    expect(html.trim().length).toBeGreaterThan(0);
  });

  it("can invoke the read_dir Rust command via window.__TAURI__", async () => {
    const result = await browser.execute(async () => {
      // @ts-expect-error -- __TAURI__ is injected by Tauri at runtime
      const entries = await window.__TAURI__.core.invoke("read_dir", { path: "." });
      return Array.isArray(entries);
    });
    expect(result).toBe(true);
  });

  it("list_ollama_models returns an array (even if empty)", async () => {
    const result = await browser.execute(async () => {
      // @ts-expect-error -- __TAURI__ is injected by Tauri at runtime
      const models = await window.__TAURI__.core.invoke("list_ollama_models", {
        host: "http://localhost:11434",
      });
      return Array.isArray(models);
    });
    expect(result).toBe(true);
  });

  it("save_model_presets and load_model_presets round-trip correctly", async () => {
    const testPreset = { label: "e2e-test", model: "test-model", host: "http://localhost" };

    const roundTripped = await browser.execute(async (preset) => {
      // @ts-expect-error -- __TAURI__ is injected at runtime
      const { core } = window.__TAURI__;
      await core.invoke("save_model_presets", { presets: [preset] });
      const loaded = await core.invoke("load_model_presets");
      return loaded;
    }, testPreset);

    expect(Array.isArray(roundTripped)).toBe(true);
    const labels = (roundTripped as { label: string }[]).map((p) => p.label);
    expect(labels).toContain("e2e-test");
  });
});
