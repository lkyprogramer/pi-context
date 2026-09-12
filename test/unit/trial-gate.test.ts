import { expect, test } from "vitest";
import { evaluateTrial } from "../../eval/local/gate.mjs";
import { candidates } from "../../eval/local/report.mjs";

test("one loss per two repetitions is not a passing quality gate", () => {
  const pairs = Array.from({ length: 12 }, (_, i) => ({
    caseId: `q${Math.floor(i / 2)}`,
    rep: i % 2,
    nativePassed: true,
    candidatePassed: i % 2 === 0,
    foldRequired: true,
    foldApplied: true,
    criticalViolation: false,
    evidencePassed: true,
  }));
  const d = evaluateTrial({
    pairs,
    capabilities: [],
    objective: { metric: "logical-input", known: true, relativeChange: 0.4, minImprovement: 0.1 },
  });
  expect(d.decision).not.toBe("limited-balanced-trial");
});

test("H02 quote failure is review-needed", () => {
  const quotePair = (rep: number) => ({
    caseId: "H02",
    rep,
    nativePassed: true,
    candidatePassed: true,
    nativeQuote: true,
    candidateQuote: false,
    foldRequired: true,
    foldApplied: true,
    criticalViolation: false,
    nativeMetric: { "fresh-input": 100 },
    candidateMetric: { "fresh-input": 80 },
  });
  const d = evaluateTrial({
    pairs: [quotePair(1), quotePair(2)],
    capabilities: [{ eligible: true, passed: true }],
    plan: { expectedPairs: 2, expectedCapabilities: 1, exactQuoteIds: ["H02"], objective: { primary: { metric: "fresh-input", minImprovement: 0.1 } } },
    attempts: [],
  });
  expect(d.decision).toBe("review-needed");
  expect(d.discordant.filter((x) => x.kind === "quote-discordant")).toHaveLength(2);
});

test("unexercised optimization cannot authorize a default change", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: false,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [],
    objective: { metric: "logical-input", known: true, relativeChange: -0.5, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("inconclusive");
});

test("no fold cannot enter the passing capability denominator", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: false,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("inconclusive");
});

test("unknown cost cannot upgrade to limited trial", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [{ eligible: true, passed: true }],
    objective: { metric: "logical-input", known: false, relativeChange: -0.2, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("quality-qualified-cost-unknown");
});

test("missing planned pair is NOT_RUN / inconclusive", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [{ eligible: true, passed: true }],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
    expectedPairs: 2,
  });
  expect(d.decision).toBe("inconclusive");
});

test("critical violation is blocked", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: true,
      evidencePassed: true,
    }],
    capabilities: [{ eligible: true, passed: true }],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("blocked");
});

test("zero recovery opportunities cannot succeed", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("inconclusive");
});

test("first-attempt and final success rates are separate", () => {
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: false,
      evidencePassed: true,
    }],
    capabilities: [{ eligible: true, passed: true }],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
    attempts: [
      { episodeId: "e", attemptId: "a1", status: "timeout", requests: [] },
      { episodeId: "e", attemptId: "a2", status: "passed", requests: [] },
    ],
  });
  expect(d.firstAttemptSuccess).toBe(0);
  expect(d.finalAttemptSuccess).toBe(1);
});

const pair = (caseId: string, rep: number, n: boolean, c: boolean) => ({
  caseId, rep, lane: "Q" as const, nativePassed: n, candidatePassed: c, nativeQuote: null, candidateQuote: null,
  foldRequired: true, foldApplied: true, criticalViolation: false, status: "complete" as const,
  nativeMetric: { "fresh-input": 45000 }, candidateMetric: { "fresh-input": 11000 },
});
const plan = { expectedPairs: 24, expectedCapabilities: 6, exactQuoteIds: [] as string[], objective: { primary: { metric: "fresh-input", minImprovement: 0.1 }, secondary: [] as string[] } };
const caps = Array.from({ length: 6 }, (_, i) => ({ caseId: i < 3 ? "C01" : "C02", rep: (i % 3) + 1, eligible: true, passed: true }));

function allPassing() {
  const pairs: ReturnType<typeof pair>[] = [];
  for (const q of ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08"]) {
    for (let r = 1; r <= 3; r++) pairs.push(pair(q, r, true, true));
  }
  return pairs;
}

test("one discordant pair with an offsetting discordant pair is not review-needed", () => {
  const pairs = allPassing();
  pairs[12] = pair("Q05", 1, false, true);
  pairs[13] = pair("Q05", 2, true, false);
  const d = evaluateTrial({ pairs, capabilities: caps, plan, attempts: [] });
  expect(d.decision).not.toBe("review-needed");
  expect(d.discordant).toEqual(expect.arrayContaining([
    expect.objectContaining({ caseId: "Q05", rep: 2, kind: "candidate-fail-native-pass" }),
  ]));
  expect(d.counts).toMatchObject({ b: 1, c: 1, shared: 0 });
});

test("two candidate-only failures on one case are review-needed with the pairs named", () => {
  const pairs = allPassing();
  pairs[12] = pair("Q05", 1, true, false);
  pairs[13] = pair("Q05", 2, true, false);
  const d = evaluateTrial({ pairs, capabilities: caps, plan, attempts: [] });
  expect(d.decision).toBe("review-needed");
  expect(d.reason).toContain("Q05/r1");
  expect(d.reason).toContain("Q05/r2");
});

test("Q05 candidate quote failure counts as a discordant failure when native quoted", () => {
  const pairs = allPassing().map((p) => p.caseId === "Q05" ? { ...p, nativeQuote: true, candidateQuote: true } : p);
  pairs[13] = { ...pair("Q05", 2, true, true), nativeQuote: true, candidateQuote: false };
  pairs[14] = { ...pair("Q05", 3, true, true), nativeQuote: true, candidateQuote: false };
  const d = evaluateTrial({ pairs, capabilities: caps, plan: { ...plan, exactQuoteIds: ["Q05"] }, attempts: [] });
  expect(d.decision).toBe("review-needed");
  expect(d.discordant.filter((x) => x.kind === "quote-discordant")).toHaveLength(2);
});

test("Q05 unmeasured quote is inconclusive, not a pass", () => {
  const pairs = allPassing().map((p) => p.caseId === "Q05" ? { ...p, nativeQuote: true, candidateQuote: true } : p);
  pairs[13] = { ...pair("Q05", 2, true, true), nativeQuote: true, candidateQuote: null };
  const d = evaluateTrial({ pairs, capabilities: caps, plan: { ...plan, exactQuoteIds: ["Q05"] }, attempts: [] });
  expect(d.decision).toBe("inconclusive");
  expect(d.reason).toMatch(/unmeasured/);
});

test("fold-time-model-hint reports below-gate with one episode and met with two", () => {
  const ep = (rep: number) => ({
    manifest: { caseId: "Q05", arm: "balanced", rep },
    status: "complete",
    mechanism: { folds: 1, historyReads: 0, historySearches: 0 },
    oracle: { passed: false },
  });
  const planQ = { qualityIds: ["Q05"], capabilityIds: [], regimeLanes: {} };
  expect(candidates({ byCaseArm: {} }, [ep(1)], planQ)).toEqual([expect.objectContaining({ candidate: "fold-time-model-hint", status: "below-gate" })]);
  expect(candidates({ byCaseArm: {} }, [ep(1), ep(2)], planQ)).toEqual([expect.objectContaining({ candidate: "fold-time-model-hint", status: "met" })]);
});
