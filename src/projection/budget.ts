import { estimateTokens, type BudgetDecision, type TokenEstimate } from "../contracts.js";

export function estimateText(text: string, includesImages = false): TokenEstimate {
  return {
    value: estimateTokens(text),
    method: "character-estimate",
    includesImages,
    upperBoundKnown: !includesImages,
  };
}

export function decideBudget(input: {
  protectedTokens: number;
  optionalTokens: number;
  limit: number;
  unknownImageCost: boolean;
}): BudgetDecision {
  if (input.unknownImageCost) return { kind: "bypass", reason: "unknown-content-cost" };
  if (input.protectedTokens > input.limit) {
    return { kind: "bypass", reason: "budget-unachievable-without-loss" };
  }
  const remaining = Math.max(0, input.limit - input.protectedTokens);
  if (input.optionalTokens <= remaining) {
    return { kind: "within", optionalTokens: input.optionalTokens, remainingOptionalTokens: remaining - input.optionalTokens };
  }
  return { kind: "within", optionalTokens: remaining, remainingOptionalTokens: 0 };
}

export function unknownCostStaysEmpty(value: number | null | undefined): number | null {
  return value === undefined || value === null || Number.isNaN(value) ? null : value;
}
