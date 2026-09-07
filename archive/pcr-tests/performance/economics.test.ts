import { describe, expect, it } from "vitest";

import { computeRealizedNet } from "@pcr/core";
import { createTokenUsageProvenance } from "../../packages/kernel/src/control/economics.js";

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

  it("keeps logical/effective input separate from optional monetary cost", () => {
    const usage = createTokenUsageProvenance({
      serializedInputTokens: 100,
      providerUsage: {
        inputTokens: 20,
        cacheReadTokens: 80,
        cacheWriteTokens: 5,
        outputTokens: 10,
      },
      pricing: {
        version: "route-v2",
        currency: "USD",
        inputPerToken: 2,
        outputPerToken: 3,
        cacheReadDiscount: 0.1,
        cacheWritePerToken: 2,
      },
    });
    expect(usage.logicalTokens).toEqual({ value: 100, source: "estimated" });
    expect(usage.effectiveInput).toEqual({ value: 100, source: "host" });
    expect(usage.monetaryCost).toEqual({ value: 96, currency: "USD", priceTableVersion: "route-v2" });
    expect("billedTokens" in usage).toBe(false);
  });

  it("does not invent monetary cost when cache discount is unknown", () => {
    const usage = createTokenUsageProvenance({
      serializedInputTokens: 100,
      providerUsage: { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10 },
      pricing: { version: "route-v2", currency: "USD", inputPerToken: 2, outputPerToken: 3 },
    });
    expect(usage.logicalTokens.value).toBe(100);
    expect(usage.effectiveInput.value).toBe(100);
    expect(usage.monetaryCost).toBeNull();
  });

  it("rejects non-finite cache write pricing even when no cache writes occurred", () => {
    const usage = createTokenUsageProvenance({
      serializedInputTokens: 10,
      providerUsage: { inputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 },
      pricing: { version: "route-v2", currency: "USD", inputPerToken: 2, outputPerToken: 3, cacheReadDiscount: 0, cacheWritePerToken: Number.NaN },
    });
    expect(usage.monetaryCost).toBeNull();
  });
});
