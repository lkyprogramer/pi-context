import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: [
      "node_modules",
      "dist",
      "apps",
      "packages",
      "test/integration/eval-runner.test.ts",
      "test/unit/report.test.ts",
      "test/integration/java-cases.test.ts",
    ],
    setupFiles: ["test/helpers/setup-env.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
