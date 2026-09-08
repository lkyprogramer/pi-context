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

function median(values: number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

export function resourceNetEvidence(pairs: EvalPair[]): boolean {
  const both = pairs.filter((p) => p.baseline.taskPassed === true && p.candidate.taskPassed === true);
  if (both.length < 8) return false;
  const b0Tok = both.map((p) => p.baseline.billedTokens).filter((n): n is number => n != null);
  const b2Tok = both.map((p) => p.candidate.billedTokens).filter((n): n is number => n != null);
  const b0Wall = both.map((p) => p.baseline.wallMs).filter((n): n is number => n != null);
  const b2Wall = both.map((p) => p.candidate.wallMs).filter((n): n is number => n != null);
  if (b0Tok.length === both.length && b2Tok.length === both.length) {
    const m0 = median(b0Tok);
    const m2 = median(b2Tok);
    const w0 = median(b0Wall);
    const w2 = median(b2Wall);
    if (m0 == null || m2 == null) return false;
    const tokenWin = m2 <= m0 * 0.9;
    const wallOk = w0 == null || w2 == null || w2 <= w0 * 1.05;
    return tokenWin && wallOk;
  }
  return false;
}

export function c2PairSuccess(pair: EvalPair, c2: { recoveryPathProven?: boolean; historyCalled?: boolean } | null | undefined): boolean {
  if (pair.taskId !== "J05") return false;
  return pair.baseline.taskPassed === false && pair.candidate.taskPassed === true && c2?.recoveryPathProven === true;
}

export function buildEvaluation(pairs: EvalPair[], extra?: { c2Proven?: boolean; j05c2?: { recoveryPathProven?: boolean } }) {
  const s = summarize(pairs);
  const bothPass = pairs.filter((p) => p.baseline.taskPassed === true && p.candidate.taskPassed === true).length;
  const c2ok = extra?.j05c2?.recoveryPathProven === true
    && pairs.some((p) => c2PairSuccess(p, extra.j05c2));
  const closedLoopCases = bothPass + (c2ok ? 1 : 0);
  const net = resourceNetEvidence(pairs);
  const b0PassB2Fail = pairs.filter((p) => p.taskId !== "J05" && p.baseline.taskPassed === true && p.candidate.taskPassed === false).length;
  const rec = extra?.c2Proven === false && !c2ok
    ? { level: "observe" as const, reason: "hard C2 not proven on this tarball" }
    : recommend({
      closedLoopCases,
      plannedCases: s.n,
      b0PassB2Fail,
      criticalViolation: pairs.some((p) => Boolean(p.baseline.criticalViolation || p.candidate.criticalViolation)),
      resourceNetEvidence: net,
    });
  return {
    ittDenominator: s.n,
    bothPass,
    closedLoopCases,
    summary: s,
    honest: honest(pairs),
    twoPercentNiClaimAllowed: twoPercentNiClaimAllowed(s.complete, s.complete === s.n && s.n >= 8),
    adverseEventUpperBound: s.complete >= 1 ? adverseEventUpperBound(s.complete) : null,
    recommendation: rec,
    resourceNetEvidence: net,
    c2Proven: extra?.c2Proven ?? null,
    syntheticExcludedFromMain: true,
  };
}
