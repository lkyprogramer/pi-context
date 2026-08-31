import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15_000,
    include: [
      "packages/*/test/**/*.test.ts",
      "apps/*/test/**/*.test.ts",
      "tests/audit/**/*.test.ts",
      "tests/meta/**/*.test.ts",
      "tests/ci/**/*.test.ts",
      "tests/contract/**/*.test.ts",
      "tests/security/**/*.test.ts",
      "tests/fault/**/*.test.ts",
      "tests/performance/**/*.test.ts",
      "tests/w1-gate/**/*.test.ts",
      "tests/w2-gate/**/*.test.ts",
      "tests/release/**/*.test.ts",
      "tests/tasks/**/*.test.ts",
      "tests/e2e/**/*.test.ts",
    ],
    exclude: [
      "tests/release/clean-install.test.ts",
      "tests/tasks/t06.test.ts",
      "tests/tasks/t52.test.ts",
      "tests/live-gate/**",
      "tests/live/**",
      "tests/acceptance/**",
    ],
  },
});
