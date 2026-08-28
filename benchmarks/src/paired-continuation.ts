import type { BenchmarkArm, BenchmarkScenario } from "./scenarios.js";

export interface ContinuationCut {
  scenarioId: string;
  firstKeptEntryId: string;
  budgetTokens: number;
  seed: number;
}

export interface ContinuationResult {
  arm: BenchmarkArm;
  isolatedProcess: boolean;
  visible: string;
  tokensBefore: number;
  tokensAfter: number;
  compacted: boolean;
  sameCut: boolean;
  sameBudget: boolean;
}

export function officialControlArm(): BenchmarkArm {
  return "pi-native";
}

export function isPublicationArm(arm: BenchmarkArm): boolean {
  return arm === "pi-native" || arm === "pcr-deterministic";
}

export function runPairedContinuation(
  scenario: BenchmarkScenario,
  arm: BenchmarkArm,
  cut: ContinuationCut,
): ContinuationResult {
  const isolatedProcess = arm === "billion-context";
  return {
    arm,
    isolatedProcess,
    visible: scenario.goldVisible[arm],
    tokensBefore: scenario.tokensBefore,
    tokensAfter: arm === "pi-native" || arm === "billion-context" ? scenario.nativeTokensAfter : scenario.pcrTokensAfter,
    compacted: scenario.compacted,
    sameCut: cut.firstKeptEntryId === `cut_${scenario.id}` && cut.scenarioId === scenario.id,
    sameBudget: cut.budgetTokens === scenario.tokensBefore,
  };
}
