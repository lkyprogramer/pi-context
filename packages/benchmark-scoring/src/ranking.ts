export interface RankingMetrics {
  readonly recallAtK: number;
  readonly precisionAtK: number;
  readonly mrr: number;
  readonly ndcgAtK: number;
}

export function computeRankingMetrics(relevant: ReadonlySet<string>, ranked: readonly string[], k: number): RankingMetrics {
  if (relevant.size === 0) {
    return { recallAtK: 0, precisionAtK: 0, mrr: 0, ndcgAtK: 0 };
  }
  const top = ranked.slice(0, k);
  const hits = top.filter((id) => relevant.has(id));
  const first = ranked.findIndex((id) => relevant.has(id));
  let dcg = 0;
  top.forEach((id, index) => {
    if (relevant.has(id)) dcg += 1 / Math.log2(index + 2);
  });
  let idcg = 0;
  const ideal = Math.min(k, relevant.size);
  for (let i = 0; i < ideal; i += 1) idcg += 1 / Math.log2(i + 2);
  return {
    recallAtK: hits.length / relevant.size,
    precisionAtK: hits.length / Math.max(k, 1),
    mrr: first === -1 ? 0 : 1 / (first + 1),
    ndcgAtK: idcg === 0 ? 0 : dcg / idcg,
  };
}
