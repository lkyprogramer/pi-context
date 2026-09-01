import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hookP95ForDecision } from "@pcr/benchmark";
import { buildSyntheticCorpus, corpusQuota } from "./corpus.js";
import { RECORDED_W1_HOOK_P95_MS, runW1EarlyNetValueGate } from "./run.js";
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

  it("keeps the recorded decision when measured delay would flip ingress", async () => {
    const measuredFastDir = mkdtempSync(join(tmpdir(), "pcr-w1-mf-"));
    const measuredSlowDir = mkdtempSync(join(tmpdir(), "pcr-w1-ms-"));
    const recordedSlowDir = mkdtempSync(join(tmpdir(), "pcr-w1-rs-"));
    const measuredFast = await runW1EarlyNetValueGate(measuredFastDir, { extraDelayMs: 0, hookP95Source: "measured" });
    const measuredSlow = await runW1EarlyNetValueGate(measuredSlowDir, { extraDelayMs: 250, hookP95Source: "measured" });
    const recordedSlow = await runW1EarlyNetValueGate(recordedSlowDir, { extraDelayMs: 250, hookP95Source: "recorded" });
    expect(measuredFast.decision).not.toBe(measuredSlow.decision);
    expect(recordedSlow.decision).toBe(measuredFast.decision);
    expect(hookP95ForDecision({ recordedMs: RECORDED_W1_HOOK_P95_MS, measuredMs: 12, source: "recorded" })).toBe(
      hookP95ForDecision({ recordedMs: RECORDED_W1_HOOK_P95_MS, measuredMs: 200, source: "recorded" }),
    );
    expect(hookP95ForDecision({ recordedMs: RECORDED_W1_HOOK_P95_MS, measuredMs: 12, source: "measured" })).not.toBe(
      hookP95ForDecision({ recordedMs: RECORDED_W1_HOOK_P95_MS, measuredMs: 200, source: "measured" }),
    );
  });

  it("evaluates synthetic PCR arms and writes a machine-readable report", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "pcr-w1-gate-"));
    await runW1EarlyNetValueGate(outDir, { hookP95Source: "recorded" });
    const { report, reportPath, decision } = await runW1EarlyNetValueGate(outDir, { hookP95Source: "recorded" });
    expect(existsSync(reportPath)).toBe(true);
    const disk = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
    expect(disk.corpusClass).toBe("synthetic-public");
    expect(disk.publicationClaim).toBe(false);
    expect(disk.usedWalkthroughConstants).toBe(false);
    expect(disk.materializerImplemented).toBe(false);
    expect(disk.compaction).toBe("pi-native-not-replaced");
    expect(disk.pcrRuntimeConsumed).toEqual(expect.arrayContaining(["captureObservation", "readEvidenceById", "buildProactiveRecallPage"]));
    expect(["proceed-to-w2", "keep-reducers-only", "keep-recovery-only", "stop"]).toContain(decision);
    expect(disk.integrity).toMatchObject({
      exact_blob_recovery: 1,
      cross_scope_leak: 0,
      hard_constraint_violation: 0,
      tool_pair_violation: 0,
    });
    expect(disk.hardGatePass).toBe(true);
    expect(Number(disk.economics && (disk.economics as { realizedNetMedian: number }).realizedNetMedian)).toBeGreaterThan(0);
    expect(Number((disk.economics as { realizedNetCi: { lower: number } }).realizedNetCi.lower)).toBeGreaterThan(0);
    expect(decision).toBe("proceed-to-w2");
    expect(disk.publicationClaim).toBe(false);
    expect(disk.usedWalkthroughConstants).toBe(false);
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
