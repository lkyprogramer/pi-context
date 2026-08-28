import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { computePairedStatistics, pairedBootstrap, type PairedStatisticsInput } from "../src/paired.js";

function loadJson(rel: string) {
  return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), rel), "utf8"));
}

const golden = {
  input: [
    { key: "s1", baseline: 0, candidate: 1 },
    { key: "s2", baseline: 1, candidate: 1 },
  ],
  options: { samples: 1000, seed: 7, statistic: "mean" as const },
  expected: loadJson("golden-vectors.json").binaryExample,
};

function unbalancedPairFixture(): PairedStatisticsInput {
  return {
    metric: "task-success",
    baseline: [
      { key: "s1", value: 1 },
      { key: "s2", value: 0 },
    ],
    candidate: [{ key: "s1", value: 1 }],
    failurePolicy: "count-arm-failure",
  };
}

describe("paired statistics", () => {
  it("matches the normative Python bootstrap golden vector", () => {
    expect(pairedBootstrap(golden.input, golden.options)).toEqual(golden.expected);
  });

  it("fails sample integrity when one arm silently drops a timeout", () => {
    const report = computePairedStatistics(unbalancedPairFixture());
    expect(report.sampleIntegrity.ok).toBe(false);
    expect(report.sampleIntegrity.errors).toContainEqual(expect.stringMatching(/missing pair/));
  });
});
