import { unknownCostStaysEmpty } from "./budget.js";

export interface CacheEconomics {
  firstChangedIndex: number | null;
  tokensBefore: number;
  tokensAfter: number;
  expectedBenefit: number | null;
  reason?: string;
}

export function expectedBenefit(input: {
  baselineCost: number | null;
  candidateCost: number | null;
  planningCost: number | null;
  recallCost: number | null;
  horizon: number;
}): number | null {
  const baseline = unknownCostStaysEmpty(input.baselineCost);
  const candidate = unknownCostStaysEmpty(input.candidateCost);
  const planning = unknownCostStaysEmpty(input.planningCost) ?? 0;
  const recall = unknownCostStaysEmpty(input.recallCost) ?? 0;
  if (baseline === null || candidate === null) return null;
  return baseline * input.horizon - candidate * input.horizon - planning - recall;
}
