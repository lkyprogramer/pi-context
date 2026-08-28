import { computeRankingMetrics, type RankingMetrics } from "./ranking.js";

export interface RecallQuery {
  readonly queryId: string;
  readonly needed: boolean;
  readonly relevantItemIds: readonly string[];
  readonly rankedItemIds: readonly string[];
  readonly injectedItemIds: readonly string[];
  readonly injectedTokens: number;
}

export interface RecallEvaluationInput {
  readonly scenarioId: string;
  readonly armId: string;
  readonly queries: readonly RecallQuery[];
  readonly baselineTaskSuccess: boolean;
  readonly candidateTaskSuccess: boolean;
}

export interface RecallEvaluationResult {
  readonly silenceRate: number;
  readonly falseInjectionRate: number;
  readonly ranking: RankingMetrics;
  readonly recallAt5: number;
}

export function scoreProactiveRecall(input: RecallEvaluationInput): RecallEvaluationResult {
  const notNeeded = input.queries.filter((query) => !query.needed);
  const silent = notNeeded.filter((query) => query.injectedItemIds.length === 0);
  const needed = input.queries.filter((query) => query.needed);
  const ranking = needed.length === 0
    ? { recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 }
    : computeRankingMetrics(new Set(needed.flatMap((query) => query.relevantItemIds)), needed.flatMap((query) => query.rankedItemIds), 5);
  return {
    silenceRate: notNeeded.length === 0 ? 1 : silent.length / notNeeded.length,
    falseInjectionRate: notNeeded.length === 0 ? 0 : 1 - silent.length / notNeeded.length,
    ranking,
    recallAt5: ranking.recallAtK,
  };
}
