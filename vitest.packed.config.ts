import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES["packed-install"].testTimeout,
    retry: LANES["packed-install"].retry,
    hookTimeout: 120_000,
    include: LANES["packed-install"].include,
    exclude: LANES["packed-install"].exclude,
  },
});
