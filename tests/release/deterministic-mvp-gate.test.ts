import { describe, expect, it } from "vitest";
import { evaluateDeterministicMvpGate, evaluateRepoDeterministicMvpGate } from "../../scripts/gates/deterministic-mvp.mjs";

function fixtureGateEvidence(overrides = {}) {
  const { netValue, ...rest } = overrides;
  return {
    freshEvidence: true,
    unsupportedPiVersionsExcluded: true,
    confidenceIntervals: { estimate: 0, lower: -0.1, upper: 0.1 },
    knownConflictsDisclosed: true,
    waivers: [],
    taskQualityNonInferior: true,
    realizedNetValue: netValue ?? rest.realizedNetValue ?? 0,
    directiveRecall: 1,
    toolPairViolations: 0,
    crashReplay: 1,
    publicationClaim: false,
    ...rest,
  };
}

describe("deterministic MVP gate", () => {
  it("stops semantic expansion when deterministic net value is non-positive", () => {
    const decision = evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: -0.01 }));
    expect(decision).toMatchObject({ decision: "stop-at-deterministic-slice" });
  });

  it("stops when quality is not non-inferior even if synthetic net is positive", () => {
    const decision = evaluateDeterministicMvpGate(
      fixtureGateEvidence({ netValue: 12, taskQualityNonInferior: false }),
    );
    expect(decision).toMatchObject({
      decision: "stop-at-deterministic-slice",
      recommendation: "publish-deterministic-mvp-only",
      publicationClaim: false,
    });
  });

  it("blocks stale evidence", () => {
    expect(evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: 1, freshEvidence: false }))).toMatchObject({
      decision: "block",
      blockers: expect.arrayContaining([expect.objectContaining({ code: "stale-evidence", kind: "correctness" })]),
    });
  });

  it("blocks when unsupported Pi versions are not excluded", () => {
    expect(
      evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: 1, unsupportedPiVersionsExcluded: false })),
    ).toMatchObject({
      decision: "block",
      blockers: expect.arrayContaining([expect.objectContaining({ code: "unsupported-pi" })]),
    });
  });

  it("requires confidence intervals", () => {
    expect(evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: 1, confidenceIntervals: null }))).toMatchObject({
      decision: "block",
      blockers: expect.arrayContaining([expect.objectContaining({ code: "missing-confidence-intervals" })]),
    });
  });

  it("requires known conflicts to be disclosed", () => {
    expect(
      evaluateDeterministicMvpGate(fixtureGateEvidence({ netValue: 1, knownConflictsDisclosed: false })),
    ).toMatchObject({
      decision: "block",
      blockers: expect.arrayContaining([expect.objectContaining({ code: "undisclosed-conflicts" })]),
    });
  });

  it("does not let a manual waiver bypass critical or high findings", () => {
    const decision = evaluateDeterministicMvpGate(
      fixtureGateEvidence({
        netValue: 4,
        taskQualityNonInferior: true,
        waivers: [{ severity: "critical", reason: "ship anyway" }],
      }),
    );
    expect(decision.decision).toBe("block");
    expect(decision.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "safety", code: "waiver-blocked" })]),
    );
  });

  it("proceeds only when net value is positive and quality is non-inferior", () => {
    const decision = evaluateDeterministicMvpGate(
      fixtureGateEvidence({
        netValue: 0.2,
        taskQualityNonInferior: true,
        artifactHashes: [{ path: "a", sha256: "abc" }],
      }),
    );
    expect(decision).toMatchObject({
      decision: "proceed-to-semantic-beta",
      recommendation: "continue-to-semantic-beta",
      artifactHashes: [{ path: "a", sha256: "abc" }],
    });
  });

  it("stops the current repo because publication-grade Native pairing is not claimed", () => {
    const report = evaluateRepoDeterministicMvpGate();
    expect(report.decision).toBe("stop-at-deterministic-slice");
    expect(report.publicationClaim).toBe(false);
    expect(report.artifactHashes.length).toBeGreaterThan(0);
    expect(report.evidence.knownConflicts).toEqual(
      expect.arrayContaining(["w2-control-is-synthetic-not-live-native"]),
    );
  });
});
