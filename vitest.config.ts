import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.ts"],
    globals: true,
    testTimeout: 10_000,
    // beforeAll in e2e tests reads preview project deps from disk — give it time
    hookTimeout: 60_000,
    // E2E tests share filesystem state (Generated.tsx, routes.ts, preview servers).
    // Run test files one at a time to prevent race conditions.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
