import { describe, expect, it } from "vitest";

import { createClusterStatistics } from "@pcr/benchmark";

describe("cluster statistics", () => {
  it("weights clusters equally instead of parameterized clones", async () => {
    const stats = createClusterStatistics({
      catalog: {
        corpusId: "pcr-bench",
        clusters: {
          temporal: ["t0", "t1", "t2", "t3"],
          negation: ["n0"],
        },
      },
    });
    const result = await stats.bootstrap({
      corpusId: "pcr-bench",
      seed: 3,
      draws: 16,
      pairs: [
        { caseId: "t0", baseline: 0, candidate: 0 },
        { caseId: "t1", baseline: 0, candidate: 0 },
        { caseId: "t2", baseline: 0, candidate: 0 },
        { caseId: "t3", baseline: 0, candidate: 0 },
        { caseId: "n0", baseline: 0, candidate: 1 },
      ],
    });
    expect(result.estimate).toBe(0.5);
    expect(result.clusters).toBe(2);
    expect(result.pairs).toBe(5);
  });
});
