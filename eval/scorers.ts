import type { EvalPair } from "../src/contracts.js";

export function missingCostIsNotZero(pair: EvalPair): boolean {
  return pair.baseline.monetaryCost !== 0 && pair.candidate.monetaryCost !== 0;
}

export function incompleteIsNotPass(pair: EvalPair): boolean {
  if (pair.baseline.status !== "complete") return pair.baseline.taskPassed === null;
  return true;
}
