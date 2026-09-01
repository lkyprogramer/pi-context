import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES.unit.testTimeout,
    retry: LANES.unit.retry,
    include: LANES.unit.include,
    exclude: LANES.unit.exclude,
  },
});
