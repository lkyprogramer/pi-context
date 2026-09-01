import { defineConfig } from "vitest/config";
import { LANES } from "./tests/meta/lane-globs.ts";

export default defineConfig({
  test: {
    testTimeout: LANES.contract.testTimeout,
    retry: LANES.contract.retry,
    include: LANES.contract.include,
    exclude: LANES.contract.exclude,
  },
});
