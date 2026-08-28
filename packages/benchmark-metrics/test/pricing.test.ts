import { describe, expect, it } from "vitest";
import { providerCost } from "../src/pricing.js";

describe("pricing", () => {
  it("keeps cache buckets distinct", () => {
    expect(providerCost({ input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 0 }, { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 })).toBeCloseTo(0.2);
  });
});
