import type { EvalPair } from "../src/contracts.js";
import { incompleteIsNotPass, missingCostIsNotZero } from "./scorers.js";

export function summarize(pairs: EvalPair[]): { n: number; complete: number; blocked: number; notRun: number } {
  return {
    n: pairs.length,
    complete: pairs.filter((p) => p.baseline.status === "complete" && p.candidate.status === "complete").length,
    blocked: pairs.filter((p) => p.baseline.status === "blocked" || p.candidate.status === "blocked").length,
    notRun: pairs.filter((p) => p.baseline.status === "not-run" || p.candidate.status === "not-run").length,
  };
}

export function honest(pairs: EvalPair[]): boolean {
  return pairs.every((p) => missingCostIsNotZero(p) && incompleteIsNotPass(p));
}
