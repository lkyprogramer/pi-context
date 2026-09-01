import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES["hermetic-integration"].testTimeout,
    retry: LANES["hermetic-integration"].retry,
    include: LANES["hermetic-integration"].include,
    exclude: LANES["hermetic-integration"].exclude,
  },
});
