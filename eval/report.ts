import type { EvalPair } from "../src/contracts.js";
import { incompleteIsNotPass, missingCostIsNotZero } from "./scorers.js";

export function summarize(pairs: EvalPair[]): {
  n: number;
  complete: number;
  blocked: number;
  notRun: number;
  incomplete: number;
  failed: number;
} {
  return {
    n: pairs.length,
    complete: pairs.filter((p) => p.baseline.status === "complete" && p.candidate.status === "complete").length,
    blocked: pairs.filter((p) => p.baseline.status === "blocked" || p.candidate.status === "blocked").length,
    notRun: pairs.filter((p) => p.baseline.status === "not-run" || p.candidate.status === "not-run").length,
    incomplete: pairs.filter((p) => p.baseline.status === "incomplete" || p.candidate.status === "incomplete").length,
    failed: pairs.filter((p) => p.baseline.taskPassed === false || p.candidate.taskPassed === false).length,
  };
}

export function honest(pairs: EvalPair[]): boolean {
  return pairs.every((p) => missingCostIsNotZero(p) && incompleteIsNotPass(p));
}

export function twoPercentNiClaimAllowed(_n: number, _allPass: boolean): false {
  return false;
}

export function adverseEventUpperBound(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  return 1 - 0.05 ** (1 / n);
}

export type Recommendation = "observe" | "limited-trial" | "balanced";

export function recommend(input: {
  closedLoopCases: number;
  plannedCases: number;
  b0PassB2Fail: number;
  criticalViolation: boolean;
  resourceNetEvidence: boolean;
}): { level: Recommendation; reason: string } {
  if (input.criticalViolation) {
    return { level: "observe", reason: "critical constraint damage" };
  }
  if (input.closedLoopCases < 8 || input.closedLoopCases < input.plannedCases) {
    return { level: "observe", reason: `closed-loop cases ${input.closedLoopCases} < 8 or planned ${input.plannedCases}` };
  }
  if (input.b0PassB2Fail > 0) {
    return { level: "observe", reason: "B0 passed and B2 failed at least once" };
  }
  if (!input.resourceNetEvidence) {
    return { level: "limited-trial", reason: "8 closed loops without resource net-gain evidence; not balanced" };
  }
  return { level: "balanced", reason: "closed loops plus resource evidence" };
}

export function buildEvaluation(pairs: EvalPair[]) {
  const s = summarize(pairs);
  const bothPass = pairs.filter((p) => p.baseline.taskPassed === true && p.candidate.taskPassed === true).length;
  const rec = recommend({
    closedLoopCases: bothPass,
    plannedCases: s.n,
    b0PassB2Fail: pairs.filter((p) => p.baseline.taskPassed === true && p.candidate.taskPassed === false).length,
    criticalViolation: pairs.some((p) => Boolean(p.baseline.criticalViolation || p.candidate.criticalViolation)),
    resourceNetEvidence: false,
  });
  return {
    ittDenominator: s.n,
    bothPass,
    summary: s,
    honest: honest(pairs),
    twoPercentNiClaimAllowed: twoPercentNiClaimAllowed(s.complete, s.complete === s.n && s.n >= 8),
    adverseEventUpperBound: s.complete >= 1 ? adverseEventUpperBound(s.complete) : null,
    recommendation: rec,
    syntheticExcludedFromMain: true,
  };
}
