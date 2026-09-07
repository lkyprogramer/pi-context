import { describe, expect, it } from "vitest";

import {
  createClusterStatistics,
  type ClusterCatalog,
  type NumericPair,
} from "@pcr/benchmark";

const CATALOG: ClusterCatalog = {
  corpusId: "pcr-bench-t47",
  clusters: {
    temporal: ["temporal-00", "temporal-01", "temporal-02", "temporal-03"],
    negation: ["negation-00"],
  },
};

function numericPairs(): NumericPair[] {
  return [
    { caseId: "temporal-00", baseline: 0, candidate: 0 },
    { caseId: "temporal-01", baseline: 0, candidate: 0 },
    { caseId: "temporal-02", baseline: 0, candidate: 0 },
    { caseId: "temporal-03", baseline: 0, candidate: 0 },
    { caseId: "negation-00", baseline: 0, candidate: 1 },
  ];
}

async function runT47Fixture() {
  const stats = createClusterStatistics({ catalog: CATALOG });
  const result = await stats.bootstrap({
    corpusId: "pcr-bench-t47",
    pairs: numericPairs(),
    seed: 7,
    draws: 64,
  });
  expect(result.clusters).toBe(2);
  expect(result.pairs).toBe(5);
  // Equal-weight cluster means: (0 + 1) / 2. Pair-weighted would be 1/5.
  expect(result.estimate).toBe(0.5);
  expect(result.lower).toBeLessThanOrEqual(result.estimate);
  expect(result.upper).toBeGreaterThanOrEqual(result.estimate);
  const table = await stats.mcnemar({
    corpusId: "pcr-bench-t47",
    pairs: [
      { caseId: "temporal-00", baseline: true, candidate: true },
      { caseId: "temporal-01", baseline: true, candidate: false },
      { caseId: "negation-00", baseline: false, candidate: true },
    ],
  });
  expect(table).toMatchObject({
    bothPass: 1,
    baselineOnly: 1,
    candidateOnly: 1,
    bothFail: 0,
    discordant: 2,
    pairs: 3,
    clusters: 2,
  });
  return { ok: true as const, task: "T47" as const, result };
}

describe("T47 Cluster-aware paired statistics", () => {
  it("cluster_aware_paired_statistics", async () => {
    await expect(runT47Fixture()).resolves.toMatchObject({ ok: true, task: "T47" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createClusterStatistics({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_STATISTICS_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed bootstrap input", async () => {
    const stats = createClusterStatistics({ catalog: CATALOG });
    await expect(stats.bootstrap({} as never)).rejects.toMatchObject({ code: "PCR_STATISTICS_INPUT_INVALID" });
  });

  it("replays equal bootstrap results for the same seed", async () => {
    const stats = createClusterStatistics({ catalog: CATALOG });
    const input = { corpusId: "pcr-bench-t47", pairs: numericPairs(), seed: 11, draws: 32 };
    const first = await stats.bootstrap(input);
    const second = await stats.bootstrap(input);
    expect(second).toEqual(first);
  });

  it("denies pairs from another corpus", async () => {
    const stats = createClusterStatistics({ catalog: CATALOG });
    await expect(stats.bootstrap({
      corpusId: "other-corpus",
      pairs: numericPairs(),
      seed: 1,
      draws: 8,
    })).rejects.toMatchObject({ code: "PCR_STATISTICS_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before resampling", async () => {
    const stats = createClusterStatistics({ catalog: CATALOG });
    const pairs = numericPairs();
    let reads = 0;
    const guarded = new Proxy(pairs, {
      get(target, property, receiver) {
        reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    await expect(stats.bootstrap({
      corpusId: "pcr-bench-t47",
      pairs: guarded,
      seed: 1,
      draws: 8,
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(reads).toBe(0);
  });
});
