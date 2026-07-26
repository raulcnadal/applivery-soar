import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
    // RBAC/auth boundary tests share module-level singletons (rate limiter
    // buckets, RBAC access cache) that must not bleed across test files —
    // one worker/context per file keeps that state isolated and matches how
    // the app actually behaves per-process.
    fileParallelism: false,
  },
});
