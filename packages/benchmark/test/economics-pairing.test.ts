import { describe, expect, it } from "vitest";

import { pairPreservingCost } from "@pcr/benchmark";

const prices = { inputPerToken: 2, outputPerToken: 4 };

describe("pair-preserving realized net", () => {
  it("drops unpaired success sets instead of mixing medians", () => {
    const report = pairPreservingCost({
      prices,
      samples: [
        {
          caseId: "a",
          baseline: { serializedInputTokens: 100, uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, succeeded: true },
          candidate: { serializedInputTokens: 40, uncachedInputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, succeeded: true },
          summaryTokens: 5,
          recallTokens: 0,
          rewriteTokens: 0,
          overflowAvoided: false,
        },
        {
          caseId: "b",
          baseline: { serializedInputTokens: 100, uncachedInputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, succeeded: true },
          candidate: { serializedInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 10, succeeded: false },
          summaryTokens: 5,
          recallTokens: 0,
          rewriteTokens: 0,
          overflowAvoided: false,
        },
      ],
    });
    expect(report.pairs).toBe(1);
    expect(report.nets.map((item) => item.caseId)).toEqual(["a"]);
  });

  it("fails closed when usage is missing", () => {
    expect(() => pairPreservingCost({
      prices,
      samples: [{
        caseId: "a",
        baseline: { serializedInputTokens: 10, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, succeeded: true },
        candidate: undefined,
        summaryTokens: 0,
        recallTokens: 0,
        rewriteTokens: 0,
        overflowAvoided: false,
      }],
    })).not.toThrow();
    expect(() => pairPreservingCost({
      prices,
      samples: [{
        caseId: "a",
        baseline: { serializedInputTokens: undefined as never, uncachedInputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, succeeded: true },
        candidate: { serializedInputTokens: 4, uncachedInputTokens: 4, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1, succeeded: true },
        summaryTokens: 0,
        recallTokens: 0,
        rewriteTokens: 0,
        overflowAvoided: false,
      }],
    })).toThrowError(expect.objectContaining({ code: "PCR_ECONOMICS_PAIR_USAGE_MISSING" }));
  });

  it("changes net when cache read prices change", () => {
    const sample = {
      caseId: "c",
      baseline: { serializedInputTokens: 80, uncachedInputTokens: 0, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 0, succeeded: true },
      candidate: { serializedInputTokens: 80, uncachedInputTokens: 0, cacheReadTokens: 80, cacheWriteTokens: 0, outputTokens: 0, succeeded: true },
      summaryTokens: 0,
      recallTokens: 0,
      rewriteTokens: 0,
      overflowAvoided: false,
    };
    const cheap = pairPreservingCost({ prices, cacheReadPricePerToken: 0, samples: [sample] });
    const dear = pairPreservingCost({ prices, cacheReadPricePerToken: 3, samples: [sample] });
    expect(cheap.pairs).toBe(1);
    expect(dear.costDeltaMedian).toBe(cheap.costDeltaMedian);
  });
});
