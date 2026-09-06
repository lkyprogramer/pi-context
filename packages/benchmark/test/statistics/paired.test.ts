import { describe, expect, it } from "vitest";

import { discordance, pairedMeanDifference, resampleClusterMeans } from "../../src/statistics/paired-small.js";

describe("paired mean statistics", () => {
  it("keeps an all-zero tie distinct from a few severe regressions", () => {
    const zeros = pairedMeanDifference([
      { caseId: "a", clusterId: "c1", baseline: 0, candidate: 0 },
      { caseId: "b", clusterId: "c1", baseline: 0, candidate: 0 },
      { caseId: "c", clusterId: "c2", baseline: 0, candidate: 0 },
    ]);
    expect(zeros.meanDiff).toBe(0);
    expect(zeros.clusterMeanDiff).toBe(0);
    expect(zeros.discordance).toEqual({ bothPass: 0, baselineOnly: 0, candidateOnly: 0, bothFail: 3 });

    const severe = pairedMeanDifference([
      { caseId: "a", clusterId: "c1", baseline: 1, candidate: 1 },
      { caseId: "b", clusterId: "c1", baseline: 1, candidate: 1 },
      { caseId: "c", clusterId: "c2", baseline: 1, candidate: 0 },
    ]);
    expect(severe.meanDiff).toBeCloseTo(-1 / 3);
    expect(severe.discordance.baselineOnly).toBe(1);
    expect(severe.discordance.bothPass).toBe(2);
    expect(severe.meanDiff).not.toBe(zeros.meanDiff);
  });

  it("resamples cluster means rather than a median CI", () => {
    const result = resampleClusterMeans({
      seed: 3,
      draws: 32,
      pairs: [
        { caseId: "t0", clusterId: "temporal", baseline: 0, candidate: 0 },
        { caseId: "t1", clusterId: "temporal", baseline: 0, candidate: 0 },
        { caseId: "n0", clusterId: "negation", baseline: 0, candidate: 1 },
      ],
    });
    expect(result.estimate).toBe(0.5);
    expect(result.samples).toHaveLength(32);
    expect(result.samples.every((value) => value === 0 || value === 0.5 || value === 1)).toBe(true);
    expect(discordance([
      { caseId: "t0", clusterId: "temporal", baseline: false, candidate: false },
      { caseId: "n0", clusterId: "negation", baseline: false, candidate: true },
    ])).toEqual({ bothPass: 0, baselineOnly: 0, candidateOnly: 1, bothFail: 1 });
  });
});
