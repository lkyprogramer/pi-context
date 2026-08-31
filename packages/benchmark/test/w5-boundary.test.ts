import { describe, expect, it } from "vitest";

import { infrastructurePolicy, runBoundaryReplay } from "@pcr/benchmark";

const CORPUS = new URL("../../../benchmarks/corpus-v2", import.meta.url).pathname;

describe("W5 boundary replay", () => {
  it("excludes dirty-tree pairs from the 90-count", () => {
    expect(infrastructurePolicy({ dirty: true, pairCount: 90 })).toEqual({
      included: 0,
      excluded: 90,
      reason: "infrastructure",
    });
  });

  it("replays the same seed to the same cut hash", async () => {
    const first = await runBoundaryReplay({ corpusRoot: CORPUS, seeds: [0, 1, 2] });
    const second = await runBoundaryReplay({ corpusRoot: CORPUS, seeds: [0, 1, 2] });
    expect(first.pairs).toBe(90);
    expect(first.clusters).toBe(30);
    expect(first.failures).toEqual([]);
    expect(second.pairsOut.map((row) => row.shapedTraceHash)).toEqual(first.pairsOut.map((row) => row.shapedTraceHash));
    const a = first.pairsOut.find((row) => row.clusterId === "temporal" && row.seed === 1);
    const b = second.pairsOut.find((row) => row.clusterId === "temporal" && row.seed === 1);
    expect(a?.b0).toBe(b?.b0);
  });
});
