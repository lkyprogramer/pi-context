import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGateEngine, type RunBundle } from "@pcr/benchmark";

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");

function bundle(overrides: Partial<RunBundle> = {}): RunBundle {
  return {
    runId: "run-v3",
    gate: "w2-compactor",
    workspaceId: "ws-report",
    integrity: {
      oracleValidity: 1,
      directiveCoverage: 1,
      toolPairViolations: 0,
      recoveryRate: 1,
      deterministicHashStable: true,
      leakCount: 0,
      unsupportedHighRisk: 0,
      crossScopeReads: 0,
    },
    continuation: { environmentSuccess: true },
    quality: { environmentSuccessLower: 0 },
    efficiency: {
      realizedNetMedian: 2,
      ingressTokenMedianDelta: -0.24,
      ingressTokenCiUpper: -0.12,
      hookP95Ms: 40,
      recallAt5: 0.95,
      recallPrecision: 0.82,
      silenceRate: 0.93,
      recallQualityCiLower: 0,
      recallNeededSuccessDelta: 0.04,
    },
    provenance: {
      commit: "c".repeat(40),
      diffHash: EMPTY_DIFF,
      dirty: false,
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      configDigest: "d".repeat(64),
    },
    sample: { clusters: 30, seedsPerCluster: 3, familyRegressions: [] },
    ...overrides,
  };
}

function engine() {
  return createGateEngine({
    workspaceId: "ws-report",
    git: { async status() { return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false }; } },
    files: { async mkdir() { return; }, async writeFile() { return; } },
  });
}

describe("gate v3 sample and family rules", () => {
  it("does not adopt a tiny positive realized net", () => {
    const decision = engine().evaluate(bundle({
      efficiency: { ...bundle().efficiency, realizedNetMedian: 0.1 },
    }));
    expect(decision.decision).toBe("keep-pi-native");
    expect(decision.reasons).toContain("insufficient-net");
  });

  it("rejects a 5-cluster or 30x1 sample profile", () => {
    expect(engine().evaluate(bundle({
      sample: { clusters: 5, seedsPerCluster: 6, familyRegressions: [] },
    })).decision).toBe("keep-pi-native");
    expect(engine().evaluate(bundle({
      sample: { clusters: 30, seedsPerCluster: 1, familyRegressions: [] },
    })).reasons).toContain("sample-profile");
  });

  it("never adopts a synthetic or component bundle as publication", () => {
    const passing = bundle({
      sample: { clusters: 30, seedsPerCluster: 3, familyRegressions: [] },
    });
    expect(engine().evaluate(passing).decision).toBe("keep-pi-native");
    expect(engine().evaluate(passing).reasons).toContain("live-provider-required");
    expect(engine().evaluate({
      ...passing,
      liveProvider: true,
      publicationClass: "live-publication",
    }).decision).toBe("adopt-pcr-compactor");
    expect(engine().evaluate({
      ...passing,
      liveProvider: false,
      publicationClass: "live-publication",
    }).reasons).toContain("live-provider-required");
  });

  it("blocks adopt when a family regresses", () => {
    const decision = engine().evaluate(bundle({
      sample: { clusters: 30, seedsPerCluster: 3, familyRegressions: ["temporal"] },
    }));
    expect(decision.decision).toBe("keep-pi-native");
    expect(decision.reasons).toContain("family-regression");
  });
});
