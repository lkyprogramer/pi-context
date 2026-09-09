import { expect, test } from "vitest";
import { evaluateTrial } from "../../eval/local/gate.mjs";

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
  const d = evaluateTrial({
    pairs: [{
      caseId: "q",
      rep: 0,
      nativePassed: true,
      candidatePassed: true,
      foldRequired: true,
      foldApplied: true,
      criticalViolation: false,
      evidencePassed: false,
    }],
    capabilities: [{ eligible: true, passed: true }],
    objective: { metric: "logical-input", known: true, relativeChange: -0.2, minImprovement: 0.1 },
  });
  expect(d.decision).toBe("review-needed");
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
