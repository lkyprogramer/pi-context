import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: [
      "tests/acceptance/packed-install.test.ts",
      "tests/release/clean-install.test.ts",
      "tests/tasks/t06.test.ts",
      "tests/tasks/t52.test.ts",
    ],
  },
});
