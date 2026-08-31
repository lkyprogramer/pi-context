import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGateEngine, sealRunBundle, verifyRunBundle, type RunBundle } from "@pcr/benchmark";

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");

function sample(): RunBundle {
  return {
    runId: "run-bundle",
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
  };
}

describe("immutable run bundle", () => {
  it("detects tampering and rejects absolute paths", () => {
    const engine = createGateEngine({
      workspaceId: "ws-report",
      git: { async status() { return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false }; } },
      files: { async mkdir() {}, async writeFile() {} },
    });
    const decision = engine.evaluate(sample());
    const sealed = sealRunBundle(sample(), decision);
    expect(verifyRunBundle(sealed).contentHash).toBe(sealed.contentHash);
    expect(() => verifyRunBundle({ ...sealed, contentHash: "e".repeat(64) })).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_TAMPERED" }),
    );
    const withPath = sealRunBundle({ ...sample(), runId: "/tmp/abs-run" }, decision);
    expect(() => verifyRunBundle(withPath)).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_ABSOLUTE_PATH" }),
    );
  });

  it("re-scores two runs to the same decision", () => {
    const engine = createGateEngine({
      workspaceId: "ws-report",
      git: { async status() { return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false }; } },
      files: { async mkdir() {}, async writeFile() {} },
    });
    const first = engine.evaluate(sample());
    const sealed = sealRunBundle(sample(), first);
    const verified = verifyRunBundle(sealed, (bundle) => engine.evaluate(bundle as never));
    expect(verified.decision.decision).toBe(first.decision);
    expect(verified.decision.reportSha256).toBe(first.reportSha256);
  });
});
