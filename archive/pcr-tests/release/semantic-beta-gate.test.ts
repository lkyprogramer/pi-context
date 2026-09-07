import { describe, expect, it } from "vitest";
import { evaluateSemanticBetaGate } from "../../scripts/gates/semantic-beta.mjs";

function fixtureSemanticEvidence(overrides = {}) {
  return {
    qualityGain: 0,
    staleCost: 0,
    staleWorkRatio: overrides.staleWorkRatio ?? overrides.staleCost ?? 0,
    maxStaleRatio: 1,
    realizedNetValue: 1,
    nonInferiorityMargin: 0.02,
    t45Decision: "proceed-to-semantic-beta",
    semanticOffArmIdentical: true,
    verifierMutationPass: true,
    providerBuckets: ["default"],
    cacheEconomicsOk: true,
    unsupportedOutcomes: 0,
    ...overrides,
  };
}

describe("semantic beta gate", () => {
  it("keeps semantic disabled when verified quality gain does not cover stale cost", () => {
    expect(evaluateSemanticBetaGate(fixtureSemanticEvidence({ qualityGain: 0, staleCost: 5 }))).toMatchObject({ semanticDefault: "off" });
  });

  it("records not-enabled-by-release-profile when T45 does not continue", () => {
    expect(
      evaluateSemanticBetaGate(
        fixtureSemanticEvidence({
          qualityGain: 1,
          staleCost: 0,
          t45Decision: "stop-at-deterministic-slice",
        }),
      ),
    ).toMatchObject({
      release: "deterministic-only",
      semanticDefault: "off",
      reasons: ["not-enabled-by-release-profile"],
    });
  });

  it("requires the semantic-off arm to stay identical to deterministic", () => {
    expect(evaluateSemanticBetaGate(fixtureSemanticEvidence({ semanticOffArmIdentical: false }))).toMatchObject({
      release: "blocked",
      semanticDefault: "off",
      reasons: expect.arrayContaining(["semantic-off-arm-diverged"]),
    });
  });

  it("blocks when the verifier mutation gate fails", () => {
    expect(evaluateSemanticBetaGate(fixtureSemanticEvidence({ verifierMutationPass: false }))).toMatchObject({
      release: "blocked",
      reasons: expect.arrayContaining(["verifier-mutation-failed"]),
    });
  });

  it("does not average away a provider or model bucket regression", () => {
    expect(evaluateSemanticBetaGate(fixtureSemanticEvidence({ criticalBucketRegressions: 1 }))).toMatchObject({
      release: "blocked",
      reasons: expect.arrayContaining(["bucket-regression"]),
    });
  });

  it("keeps semantic off when background stale work exceeds budget", () => {
    expect(
      evaluateSemanticBetaGate(
        fixtureSemanticEvidence({
          qualityGain: 1,
          staleCost: 0,
          staleWorkRatio: 2,
          maxStaleRatio: 0.2,
        }),
      ),
    ).toMatchObject({
      release: "deterministic-only",
      semanticDefault: "off",
      reasons: ["insufficient-net-value"],
    });
  });

  it("keeps semantic off when cache economics are not covered", () => {
    expect(
      evaluateSemanticBetaGate(fixtureSemanticEvidence({ qualityGain: 1, staleCost: 0, cacheEconomicsOk: false })),
    ).toMatchObject({ semanticDefault: "off" });
  });

  it("enables quality-profile-only only when gain covers stale cost and T45 continues", () => {
    expect(
      evaluateSemanticBetaGate(
        fixtureSemanticEvidence({
          qualityGain: 0.2,
          staleCost: 0.01,
          staleWorkRatio: 0.1,
          realizedNetValue: 3,
          cacheEconomicsOk: true,
        }),
      ),
    ).toMatchObject({
      release: "beta",
      semanticDefault: "quality-profile-only",
      reasons: [],
    });
  });
});
