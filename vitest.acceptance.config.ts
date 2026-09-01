import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES["product-acceptance"].testTimeout,
    retry: LANES["product-acceptance"].retry,
    include: LANES["product-acceptance"].include,
    exclude: LANES["product-acceptance"].exclude,
  },
});
