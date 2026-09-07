import { describe, expect, it } from "vitest";
import { decideBudget, unknownCostStaysEmpty } from "../../src/projection/budget.js";

describe("T12 budget", () => {
  it("unknown multimodal cost bypasses instead of counting 0", () => {
    expect(decideBudget({ protectedTokens: 10, optionalTokens: 5, limit: 100, unknownImageCost: true })).toEqual({
      kind: "bypass",
      reason: "unknown-content-cost",
    });
    expect(unknownCostStaysEmpty(undefined)).toBeNull();
    expect(unknownCostStaysEmpty(null)).toBeNull();
  });

  it("protected overflow is unachievable without loss", () => {
    expect(decideBudget({ protectedTokens: 500, optionalTokens: 1, limit: 100, unknownImageCost: false }).kind).toBe("bypass");
  });
});
