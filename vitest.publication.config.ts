import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES["publication-benchmark"].testTimeout,
    retry: LANES["publication-benchmark"].retry,
    include: LANES["publication-benchmark"].include,
    exclude: LANES["publication-benchmark"].exclude,
  },
});
