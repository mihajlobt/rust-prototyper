/**
 * WebdriverIO configuration for Tauri native IPC tests.
 *
 * Prerequisites before running:
 *   1. Build the Tauri binary:  bun tauri build
 *   2. Run tests:               bun test:tauri
 *
 * Supported platforms: Linux and Windows only.
 * macOS has no WKWebView driver (see https://v2.tauri.app/develop/tests/webdriver/).
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compiled Tauri binary produced by `bun tauri build`
const BINARY_PATH = path.join(
  __dirname,
  "../../../src-tauri/target/release/prototyper",
);

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: [path.join(__dirname, "**/*.test.ts")],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "",
      "tauri:options": {
        application: BINARY_PATH,
      },
    } as WebdriverIO.Capabilities,
  ],
  services: ["@crabnebula/tauri-driver"],
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
