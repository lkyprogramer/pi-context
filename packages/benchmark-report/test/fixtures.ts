import type { GateEvaluationInput } from "../src/gates.js";

export function reportFixture(overrides: Partial<GateEvaluationInput> = {}): GateEvaluationInput {
  return {
    gate: "w1-early-net-value",
    integrityPass: true,
    qualityCiLower: -0.01,
    qualityMargin: 0.03,
    ingressTokenMedianDelta: -0.24,
    ingressTokenCiUpper: -0.12,
    hookP95Ms: 40,
    recallAt5: 0.95,
    recallPrecision: 0.82,
    silenceRate: 0.93,
    recallQualityCiLower: -0.005,
    recallQualityMargin: 0.01,
    recallNeededSuccessDelta: 0.04,
    realizedNetMedian: 0.01,
    ...overrides,
  };
}

export function w1PartialFixture(): GateEvaluationInput {
  return reportFixture({ recallAt5: 0.5, recallNeededSuccessDelta: 0 });
}
