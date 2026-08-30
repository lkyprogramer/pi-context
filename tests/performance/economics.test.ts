import { describe, expect, it } from "vitest";

import { computeRealizedNet } from "@pcr/core";

describe("cache-adjusted realized net", () => {
  it("prices cache rewrite after the eligible prefix and zeros benefits on failure", () => {
    const prices = { inputPerToken: 2, outputPerToken: 3 };
    const success = computeRealizedNet({
      tokensBefore: 190_000,
      tokensAfter: 12_000,
      summaryTokens: 400,
      recallTokens: 50,
      rewriteTokens: 20,
      succeeded: true,
      overflowAvoided: true,
    }, prices);
    expect(success.cacheRewrite).toBe(40);
    expect(success.failureCost).toBe(0);
    expect(success.net).toBeGreaterThan(0);
    const failed = computeRealizedNet({
      tokensBefore: 190_000,
      tokensAfter: 12_000,
      summaryTokens: 400,
      recallTokens: 50,
      rewriteTokens: 20,
      succeeded: false,
      overflowAvoided: true,
    }, prices);
    expect(failed.avoidedInput).toBe(0);
    expect(failed.avoidedOverflow).toBe(0);
    expect(failed.failureCost).toBe(190_000 * 2);
    expect(failed.net).toBeLessThan(success.net);
  });
});
