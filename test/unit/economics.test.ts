import { describe, expect, it } from "vitest";
import { unknownCostStaysEmpty } from "../../src/projection/budget.js";
import { normalizeUsage } from "../../src/telemetry/usage.js";

describe("T16 economics", () => {
  it("unknown prices stay null and are not zeroed", () => {
    expect(unknownCostStaysEmpty(null)).toBeNull();
    const usage = normalizeUsage({ inputTokens: 10, outputTokens: 2 }, { provider: "x", model: "y", purpose: "agent" });
    expect(usage.monetaryCost).toBeNull();
    expect(usage.complete).toBe(false);
    expect(usage.uncachedInputTokens).toBe(10);
  });
});
