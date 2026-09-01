import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES["live-provider-smoke"].testTimeout,
    retry: LANES["live-provider-smoke"].retry,
    include: LANES["live-provider-smoke"].include,
    exclude: LANES["live-provider-smoke"].exclude,
  },
});
