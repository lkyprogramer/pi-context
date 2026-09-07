import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "dist", "apps", "packages"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
