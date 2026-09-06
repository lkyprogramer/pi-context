import { describe, expect, it } from "vitest";

import { discordance, pairedMeanDifference, resampleClusterMeans, summarizePairedSuccess } from "../../src/statistics/paired-small.js";

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

  it("bootstraps cluster success deltas and keeps ci95 null below two clusters", () => {
    const one = summarizePairedSuccess(
      [{ clusterId: "only", baseline: true, candidate: true }],
      { bootstrapSamples: 64, seed: 7 },
    );
    expect(one.clusters).toBe(1);
    expect(one.ci95).toBeNull();
    expect(one.meanDelta).toBe(0);
    const two = summarizePairedSuccess(
      [
        { clusterId: "a", baseline: true, candidate: true },
        { clusterId: "a", baseline: true, candidate: false },
        { clusterId: "b", baseline: false, candidate: true },
      ],
      { bootstrapSamples: 200, seed: 11 },
    );
    expect(two.clusters).toBe(2);
    expect(two.discordance).toEqual({ bothPass: 1, baselineOnly: 1, candidateOnly: 1, bothFail: 0 });
    expect(two.ci95).not.toBeNull();
    expect(two.ci95![0]).toBeLessThanOrEqual(two.ci95![1]);
    expect(() => summarizePairedSuccess([], { bootstrapSamples: 8, seed: 1 })).toThrow(/PCR_PAIRED_INPUT_INVALID/);
  });
});
