import { describe, expect, it } from "vitest";
import { computeRankingMetrics } from "../src/ranking.js";
import { scoreProactiveRecall, type RecallEvaluationInput } from "../src/recall.js";

function notNeededButInjectedFixture(): RecallEvaluationInput {
  return {
    scenarioId: "new-task",
    armId: "A2",
    queries: [
      {
        queryId: "q1",
        needed: false,
        relevantItemIds: [],
        rankedItemIds: ["old-1"],
        injectedItemIds: ["old-1"],
        injectedTokens: 120,
      },
    ],
    baselineTaskSuccess: true,
    candidateTaskSuccess: true,
  };
}

describe("proactive recall", () => {
  it("computes recall@5 and mrr from oracle item ids", () => {
    const m = computeRankingMetrics(new Set(["e2", "e4"]), ["e9", "e2", "e4"], 5);
    expect(m.recallAtK).toBe(1);
    expect(m.mrr).toBe(0.5);
  });

  it("penalizes injection on recall-not-needed turns", () => {
    const result = scoreProactiveRecall(notNeededButInjectedFixture());
    expect(result.silenceRate).toBe(0);
    expect(result.falseInjectionRate).toBe(1);
  });

  it("micro-averages needed queries instead of flattening ranks", () => {
    const result = scoreProactiveRecall({
      scenarioId: "paired",
      armId: "A2",
      queries: [
        {
          queryId: "needed-hit",
          needed: true,
          relevantItemIds: ["old-error-1"],
          rankedItemIds: ["old-error-1"],
          injectedItemIds: ["old-error-1"],
          injectedTokens: 20,
        },
        {
          queryId: "needed-miss",
          needed: true,
          relevantItemIds: ["old-error-2"],
          rankedItemIds: ["noise"],
          injectedItemIds: ["noise"],
          injectedTokens: 20,
        },
      ],
      baselineTaskSuccess: true,
      candidateTaskSuccess: true,
    });
    expect(result.recallAt5).toBe(0.5);
    expect(result.pagePrecision).toBe(0.5);
    expect(result.recallAt5).toBeLessThanOrEqual(1);
  });
});
