import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildW2SyntheticCorpus, corpusQuota } from "./corpus.js";
import { runW2CompactorGate } from "./run.js";
import { evaluateW2Gate } from "./scorer.js";

const passingInput = {
  hardGatePass: true,
  qualityCiLower: 0.01,
  polarityCiLower: 0.01,
  timeCiLower: 0.01,
  updateCiLower: 0.01,
  abstentionCiLower: 0.01,
  qualityMargin: 0.02,
  closedLoopSuccessCiLower: 0.01,
  constraintViolationsCandidate: 0,
  constraintViolationsBaseline: 8,
  tokenMedianRelativeDelta: -0.18,
  costPerSuccessRelativeDelta: -0.12,
  overflowRecoveryBetter: true,
  overflowQualityNonInferior: true,
  realizedNetMedian: 40,
  budgetMismatchRate: 0,
};

describe("W2 Compactor Head-to-head Gate", () => {
  it("meets the synthetic 100-boundary quotas", () => {
    const quota = corpusQuota(buildW2SyntheticCorpus());
    expect(quota.total).toBe(100);
    expect(quota.families["tool-heavy"]).toBe(20);
    expect(quota.families.constraint).toBe(20);
    expect(quota.families["temporal-update"]).toBe(20);
    expect(quota.families.branch).toBe(20);
    expect(quota.families.overflow).toBe(20);
    expect(quota.cjk).toBeGreaterThanOrEqual(20);
  });

  it("does not adopt PCR from a failed hard gate or non-positive realized net", () => {
    expect(evaluateW2Gate({ ...passingInput, hardGatePass: false })).toBe("keep-pi-native");
    expect(evaluateW2Gate({ ...passingInput, realizedNetMedian: 0 })).toBe("keep-pi-native");
    expect(evaluateW2Gate({ ...passingInput, qualityCiLower: -0.03 })).toBe("keep-pi-native");
    expect(evaluateW2Gate(passingInput)).toBe("proceed-to-semantic");
  });

  it("evaluates live PCR B1/B2 against synthetic B0 and writes a machine-readable report", async () => {
    const { report, reportPath, decision } = await runW2CompactorGate();
    expect(existsSync(reportPath)).toBe(true);
    const disk = JSON.parse(readFileSync(reportPath, "utf8")) as typeof report;
    const decisionDisk = JSON.parse(readFileSync("artifacts/runs/w2-synthetic/gate-decision.json", "utf8")) as {
      gate: string;
      decision: string;
      reportSha256: string;
    };
    expect(disk.corpusClass).toBe("synthetic-public");
    expect(disk.publicationClaim).toBe(false);
    expect(disk.usedWalkthroughConstants).toBe(false);
    expect(disk.livePiNative).toBe(false);
    expect(disk.b0Kind).toBe("synthetic-pi-native-like-summarizer");
    expect(disk.materializerImplemented).toBe(true);
    expect(disk.compaction).toBe("pcr-deterministic-checkpoint");
    expect(disk.pcrRuntimeConsumed).toEqual(
      expect.arrayContaining([
        "captureObservation",
        "buildDeterministicCheckpointCandidate",
        "renderHostCheckpoint",
        "ContextMaterializer",
      ]),
    );
    expect(disk.baselineArm).toBe("B0");
    expect(disk.candidateArms).toEqual(["B1", "B2"]);
    expect(disk.qualityNonInferiorityMargin).toBe(0.02);
    expect((disk.quotas as { total: number }).total).toBe(100);
    expect(disk.hard).toMatchObject({
      directiveCoverage: 1,
      unsupportedHighRiskOutcome: 0,
      toolPairViolation: 0,
      mustOmitLeak: 0,
      exactEvidenceRecovery: 1,
      outputHashStable: true,
    });
    expect(disk.hardGatePass).toBe(true);
    expect((disk.sharedBoundary as { sameSourceSpan: boolean }).sameSourceSpan).toBe(true);
    expect(Number((disk.economics as { realizedNetMedian: number }).realizedNetMedian)).toBeGreaterThan(0);
    expect(Number((disk.economics as { realizedNetCi: { lower: number } }).realizedNetCi.lower)).toBeGreaterThan(0);
    expect(Number((disk.efficiency as { tokenMedianRelativeDelta: number }).tokenMedianRelativeDelta)).toBeLessThanOrEqual(-0.15);
    expect(Number((disk.efficiency as { budgetMismatchRate: number }).budgetMismatchRate)).toBe(0);
    expect(["proceed-to-semantic", "adopt-pcr-compactor", "keep-pi-native"]).toContain(decision);
    expect(decision).toBe("proceed-to-semantic");
    expect(decisionDisk.gate).toBe("w2-compactor");
    expect(decisionDisk.decision).toBe(decision);
    expect(decisionDisk.reportSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(disk.publicationClaim).toBe(false);
    expect(disk.usedWalkthroughConstants).toBe(false);
  });
});
