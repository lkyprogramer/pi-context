import { describe, expect, it } from "vitest";
import { plannedPair, plannedSmokePairs, consumeBudget, loadSmokePlan } from "../../eval/runner.js";
import {
  adverseEventUpperBound,
  buildEvaluation,
  honest,
  recommend,
  summarize,
  twoPercentNiClaimAllowed,
} from "../../eval/report.js";

describe("T24 report", () => {
  it("n=0/not-run stays not-run and missing cost is not 0", () => {
    const pairs = [plannedPair("J01", "java")];
    const s = summarize(pairs);
    expect(s.complete).toBe(0);
    expect(honest(pairs)).toBe(true);
    expect(pairs[0]?.candidate.monetaryCost).not.toBe(0);
  });

  it("eightClustersAllPassDoesNotClaimTwoPercentNI", () => {
    expect(twoPercentNiClaimAllowed(8, true)).toBe(false);
    expect(adverseEventUpperBound(8)).toBeGreaterThan(0.3);
    const rec = recommend({
      closedLoopCases: 8,
      plannedCases: 8,
      b0PassB2Fail: 0,
      criticalViolation: false,
      resourceNetEvidence: false,
    });
    expect(rec.level).not.toBe("balanced");
    expect(rec.level).toBe("limited-trial");
  });

  it("withholds limited-trial when C2 is not proven even if 8 both-pass", () => {
    const pairs = plannedSmokePairs().map((p, i) => ({
      ...p,
      baseline: { ...p.baseline, status: "complete", taskPassed: true, wallMs: 1000, billedTokens: 100 },
      candidate: { ...p.candidate, status: "complete", taskPassed: true, wallMs: 900, billedTokens: 80 },
    }));
    const noC2 = buildEvaluation(pairs, { c2Proven: false });
    expect(noC2.recommendation.level).toBe("observe");
    const yes = buildEvaluation(pairs, { c2Proven: true });
    expect(yes.resourceNetEvidence).toBe(true);
    expect(yes.recommendation.level).toBe("balanced");
  });

  it("ITT denominator is the planned smoke pairs", () => {
    const plan = loadSmokePlan();
    const pairs = plannedSmokePairs();
    expect(pairs.length).toBe(plan.caseIds.length);
    const evaluation = buildEvaluation(pairs);
    expect(evaluation.ittDenominator).toBe(plan.caseIds.length);
    expect(evaluation.twoPercentNiClaimAllowed).toBe(false);
    expect(evaluation.syntheticExcludedFromMain).toBe(true);
  });

  it("budget exhaustion leaves remaining incomplete rather than dropping the denominator", () => {
    const after = consumeBudget(10, 12);
    expect(after.exhausted).toBe(true);
    const pairs = plannedSmokePairs();
    expect(pairs).toHaveLength(8);
  });
});
