import { describe, expect, it } from "vitest";
import { computeRealizedNet, measureEconomics, type EconomicsInput, type ProviderUsage, type RealizedNetInput } from "../src/economics.js";

const price = { inputPerMillion: 2, outputPerMillion: 8, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 };
const expectedSeparateBucketCost = (100 * 2 + 1000 * 0.2 + 200 * 2.5) / 1_000_000;

function costFixture(usage: Partial<ProviderUsage>): EconomicsInput {
  return { usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...usage }, price, spans: [], qualityGatePassed: true };
}

function netFixture(): RealizedNetInput {
  return {
    qualityGatePassed: true,
    avoidedInputCost: 1,
    avoidedOverflowCost: 0,
    summaryCost: 0.2,
    cacheRewriteCost: 0.1,
    recallCost: 0.1,
    backgroundWasteCost: 0,
    configuredLatencyCost: 0,
  };
}

describe("economics", () => {
  it("uses cache read/write prices separately", () => {
    const r = measureEconomics(costFixture({ input: 100, cacheRead: 1000, cacheWrite: 200 }));
    expect(r.providerCost).toBeCloseTo(expectedSeparateBucketCost);
  });

  it("does not allow token savings to offset a quality failure", () => {
    expect(() => computeRealizedNet({ ...netFixture(), qualityGatePassed: false })).toThrow(/quality gate/);
  });
});
