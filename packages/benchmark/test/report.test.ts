import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGateEngine, type RunBundle } from "@pcr/benchmark";

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");

function bundle(overrides: Partial<RunBundle> = {}): RunBundle {
  return {
    runId: "run-report",
    gate: "w1-early-net-value",
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
    quality: { environmentSuccessLower: -0.01 },
    efficiency: {
      realizedNetMedian: 0.02,
      ingressTokenMedianDelta: -0.24,
      ingressTokenCiUpper: -0.12,
      hookP95Ms: 40,
      recallAt5: 0.95,
      recallPrecision: 0.82,
      silenceRate: 0.93,
      recallQualityCiLower: -0.005,
      recallNeededSuccessDelta: 0.04,
    },
    provenance: {
      commit: "c".repeat(40),
      diffHash: EMPTY_DIFF,
      dirty: false,
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      configDigest: "d".repeat(64),
    },
    ...overrides,
  };
}

function engine() {
  return createGateEngine({
    workspaceId: "ws-report",
    git: {
      async status() {
        return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false };
      },
    },
    files: { async mkdir() { return; }, async writeFile() { return; } },
  });
}

describe("gate engine", () => {
  it("stops on integrity failure despite large token savings", () => {
    const decision = engine().evaluate(bundle({
      integrity: { ...bundle().integrity, toolPairViolations: 4 },
      efficiency: { ...bundle().efficiency, realizedNetMedian: 99, ingressTokenMedianDelta: -0.9 },
    }));
    expect(decision.decision).toBe("stop");
    expect(decision.hardGatePass).toBe(false);
  });

  it("does not let summary-only continuation pass the quality layer", () => {
    const decision = engine().evaluate(bundle({ continuation: { environmentSuccess: false } }));
    expect(decision.decision).toBe("stop");
  });

  it("does not write a bundle when git HEAD is not the attested commit", async () => {
    let writes = 0;
    const gate = createGateEngine({
      workspaceId: "ws-report",
      git: {
        async status() {
          return { commit: "1".repeat(40), diffHash: EMPTY_DIFF, dirty: false };
        },
      },
      files: {
        async mkdir() { writes += 1; },
        async writeFile() { writes += 1; },
      },
    });
    await expect(gate.writeImmutableBundle(bundle(), "/out")).rejects.toMatchObject({
      code: "PCR_GATE_INPUT_INVALID",
      details: { field: "provenance" },
    });
    expect(writes).toBe(0);
  });

  it("refuses a dirty tree as infrastructure rather than a quality win", () => {
    const decision = engine().evaluate(bundle({
      provenance: { ...bundle().provenance, dirty: true, diffHash: "e".repeat(64) },
    }));
    expect(decision.decision).toBe("repeat-after-infrastructure-fix");
  });

  it("keeps checkpoint, materialized view, request, and provider usage distinct", () => {
    const layered = bundle({
      usageLayers: {
        checkpoint: { tokens: { value: 40, source: "estimated" } },
        materializedView: { tokens: { value: 55, source: "estimated" } },
        request: {
          inputTokens: { value: 60, source: "host" },
          outputTokens: { value: 5, source: "assistant-entry" },
        },
        providerUsage: { totalTokens: { value: 65, source: "assistant-entry" } },
      },
    });
    const decision = engine().evaluate(layered);
    expect(decision.reportSha256).not.toBe(engine().evaluate(bundle()).reportSha256);
  });
});
