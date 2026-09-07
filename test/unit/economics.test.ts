import { describe, expect, it } from "vitest";
import { expectedBenefit } from "../../src/projection/cache.js";
import { normalizeUsage } from "../../src/telemetry/usage.js";

describe("T16 economics", () => {
  it("unknown prices stay null and are not zeroed", () => {
    expect(expectedBenefit({ baselineCost: null, candidateCost: 1, planningCost: 0, recallCost: 0, horizon: 3 })).toBeNull();
    const usage = normalizeUsage({ inputTokens: 10, outputTokens: 2 }, { provider: "x", model: "y", purpose: "agent" });
    expect(usage.monetaryCost).toBeNull();
    expect(usage.complete).toBe(false);
    expect(usage.uncachedInputTokens).toBe(10);
  });
});
