import { describe, expect, it } from "vitest";

import { estimateErrorBucket, reconcileUsage, USAGE_PRICING_TABLE_VERSION } from "../src/telemetry/usage.js";

describe("capacity / cache / cost usage telemetry", () => {
  it("keeps serialized capacity independent of a cache hit billing split", () => {
    const usage = reconcileUsage({
      serializedInputTokens: 800,
      cacheHit: true,
      overflowRetry: false,
      provider: { cacheReadTokens: 790, outputTokens: 40 },
      inputPricePerToken: 2,
      cacheReadPricePerToken: 0.2,
      outputPricePerToken: 3,
    });
    expect(usage.serializedInputTokens).toBe(800);
    expect(usage.uncachedInputTokens).toBe(0);
    expect(usage.cacheReadTokens).toBe(790);
    expect(usage.outputTokens).toBe(40);
    expect(usage.estimatedCost).toBe(790 * 0.2 + 40 * 3);
    expect(usage).not.toHaveProperty("input");
  });

  it("falls back to the estimator when provider fields are missing", () => {
    const miss = reconcileUsage({
      serializedInputTokens: 500,
      cacheHit: false,
      overflowRetry: false,
      inputPricePerToken: 1,
      outputPricePerToken: 2,
    });
    expect(miss.uncachedInputTokens).toBe(500);
    expect(miss.cacheReadTokens).toBe(0);
    expect(miss.cacheWriteTokens).toBe(0);
    expect(miss.outputTokens).toBe(0);
    expect(miss.totalBilledTokens).toBe(500);
    expect(miss.pricingTableVersion).toBe(USAGE_PRICING_TABLE_VERSION);
  });

  it("marks overflow retries on the tokenizer revision without renaming capacity as billed input", () => {
    const usage = reconcileUsage({
      serializedInputTokens: 1200,
      cacheHit: false,
      overflowRetry: true,
      provider: { inputTokens: 900, cacheWriteTokens: 200, outputTokens: 30 },
      inputPricePerToken: 4,
      outputPricePerToken: 5,
    });
    expect(usage.tokenizerRevision).toBe("overflow-retry");
    expect(usage.serializedInputTokens).toBe(1200);
    expect(usage.uncachedInputTokens).toBe(900);
    expect(usage.cacheWriteTokens).toBe(200);
    expect(usage.estimatedCost).toBe(900 * 4 + 200 * 4 + 30 * 5);
    expect(estimateErrorBucket(1200, 900)).toBe("gte30");
    expect(estimateErrorBucket(100, 108)).toBe("lt15");
  });
});
