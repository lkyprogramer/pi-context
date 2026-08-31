import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/acceptance/**/*.test.ts"],
    exclude: ["tests/acceptance/packed-install.test.ts"],
  },
});
