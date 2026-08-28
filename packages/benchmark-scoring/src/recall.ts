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
  readonly pagePrecision: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function scoreProactiveRecall(input: RecallEvaluationInput): RecallEvaluationResult {
  const notNeeded = input.queries.filter((query) => !query.needed);
  const silent = notNeeded.filter((query) => query.injectedItemIds.length === 0);
  const needed = input.queries.filter((query) => query.needed);
  const perQuery = needed.map((query) => {
    const ranking = computeRankingMetrics(new Set(query.relevantItemIds), query.rankedItemIds, 5);
    const pageHits = query.injectedItemIds.filter((id) => query.relevantItemIds.includes(id)).length;
    return {
      ranking,
      pagePrecision: query.injectedItemIds.length === 0 ? 0 : pageHits / query.injectedItemIds.length,
    };
  });
  const ranking = {
    recallAtK: mean(perQuery.map((row) => row.ranking.recallAtK)),
    precisionAtK: mean(perQuery.map((row) => row.ranking.precisionAtK)),
    mrr: mean(perQuery.map((row) => row.ranking.mrr)),
    ndcgAtK: mean(perQuery.map((row) => row.ranking.ndcgAtK)),
  };
  return {
    silenceRate: notNeeded.length === 0 ? 1 : silent.length / notNeeded.length,
    falseInjectionRate: notNeeded.length === 0 ? 0 : 1 - silent.length / notNeeded.length,
    ranking,
    recallAt5: ranking.recallAtK,
    pagePrecision: mean(perQuery.map((row) => row.pagePrecision)),
  };
}
