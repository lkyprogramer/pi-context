import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "tests/acceptance/**/*.test.ts",
      "tests/live/**/*.test.ts",
      "tests/integration/**/*.test.ts",
    ],
    exclude: [
      "tests/acceptance/packed-install.test.ts",
      "tests/live-gate/**",
    ],
  },
});
