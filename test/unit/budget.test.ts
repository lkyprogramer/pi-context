import { describe, expect, it } from "vitest";
import { readBudgetFor, unknownCostStaysEmpty } from "../../src/projection/budget.js";
import { DEFAULT_CONFIG } from "../../src/config.js";

describe("T12 budget", () => {
  it("unknown prices stay null and are not zeroed", () => {
    expect(unknownCostStaysEmpty(undefined)).toBeNull();
    expect(unknownCostStaysEmpty(null)).toBeNull();
  });

  it("tight remaining window is insufficient rather than a half page", () => {
    const budget = readBudgetFor(DEFAULT_CONFIG, undefined, { tokens: 900, contextWindow: 1000, percent: 90 });
    expect(budget).toEqual({ insufficient: true });
  });
});
