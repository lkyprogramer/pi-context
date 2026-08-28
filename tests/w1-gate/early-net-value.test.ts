import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildSyntheticCorpus, corpusQuota } from "./corpus.js";
import { runW1EarlyNetValueGate } from "./run.js";
import { evaluateW1Gate } from "./scorer.js";

describe("W1 Early Net Value Gate", () => {
  it("meets the synthetic 60-boundary quotas", () => {
    const quota = corpusQuota(buildSyntheticCorpus());
    expect(quota.total).toBe(60);
    expect(quota.families["tool-heavy"]).toBe(20);
    expect(quota.families["delayed-constraint"]).toBe(20);
    expect(quota.families["recall-needed"]).toBe(10);
    expect(quota.families["recall-not-needed"]).toBe(10);
    expect(quota.cjk).toBeGreaterThanOrEqual(20);
    expect(quota.failFixVerify).toBeGreaterThanOrEqual(20);
    expect(quota.malicious).toBeGreaterThanOrEqual(15);
  });

  it("evaluates live PCR arms and writes a machine-readable report", async () => {
    const { report, reportPath, decision } = await runW1EarlyNetValueGate();
    expect(existsSync(reportPath)).toBe(true);
    const disk = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
    expect(disk.corpusClass).toBe("synthetic-public");
    expect(disk.publicationClaim).toBe(false);
    expect(disk.usedWalkthroughConstants).toBe(false);
    expect(disk.materializerImplemented).toBe(false);
    expect(disk.compaction).toBe("pi-native-not-replaced");
    expect(disk.pcrRuntimeConsumed).toEqual(expect.arrayContaining(["captureObservation", "readEvidenceById", "buildProactiveRecallPage"]));
    expect(["proceed-to-w2", "keep-reducers-only", "keep-recovery-only", "stop"]).toContain(decision);
    expect(disk.integrity).toMatchObject({ exact_blob_recovery: 1, tool_pair_violation: 0 });
    if (disk.decision === "proceed-to-w2") {
      expect(disk.publicationClaim).toBe(false);
      expect(disk.usedWalkthroughConstants).toBe(false);
    }
  });

  it("does not proceed to W2 from walkthrough constants alone", () => {
    expect(
      evaluateW1Gate({
        integrityPass: true,
        qualityCiLower: -0.021,
        qualityMargin: 0.03,
        ingressTokenMedianDelta: -0.24,
        ingressTokenCiUpper: -0.12,
        hookP95Ms: 42,
        recallAt5: 0.94,
        recallPrecision: 0.81,
        silenceRate: 0.92,
        recallQualityCiLower: -0.004,
        recallQualityMargin: 0.01,
        recallNeededSuccessDelta: 0.05,
        realizedNetMedian: 0.008,
      }),
    ).toBe("proceed-to-w2");
    expect(
      evaluateW1Gate({
        integrityPass: true,
        qualityCiLower: -0.01,
        qualityMargin: 0.03,
        ingressTokenMedianDelta: -0.24,
        ingressTokenCiUpper: -0.12,
        hookP95Ms: 40,
        recallAt5: 0.95,
        recallPrecision: 0.82,
        silenceRate: 0.93,
        recallQualityCiLower: -0.005,
        recallQualityMargin: 0.01,
        recallNeededSuccessDelta: -0.03,
        realizedNetMedian: 0.01,
      }),
    ).toBe("keep-reducers-only");
  });
});
