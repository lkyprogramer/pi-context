import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createGateEngine, type RunBundle } from "@pcr/benchmark";

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");
const COMMIT = "a".repeat(40);
const CONFIG = "b".repeat(64);

function bundle(overrides: Partial<RunBundle> = {}): RunBundle {
  return {
    runId: "run-t49",
    gate: "w1-early-net-value",
    workspaceId: "ws-t49",
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
      commit: COMMIT,
      diffHash: EMPTY_DIFF,
      dirty: false,
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      configDigest: CONFIG,
    },
    ...overrides,
  };
}

function memoryFiles() {
  const blobs = new Map<string, Uint8Array>();
  return {
    blobs,
    async mkdir() { return; },
    async writeFile(path: string, bytes: Uint8Array) { blobs.set(path, bytes); },
  };
}

function gitPort(workspaceId = "ws-t49", dirty = false, diffHash = EMPTY_DIFF) {
  return {
    async status(scope: { workspaceId: string }) {
      if (scope.workspaceId !== workspaceId) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return { commit: COMMIT, diffHash, dirty };
    },
  };
}

function engine() {
  return createGateEngine({
    workspaceId: "ws-t49",
    git: gitPort(),
    files: memoryFiles(),
  });
}

async function runT49Fixture() {
  const files = memoryFiles();
  const gate = createGateEngine({ workspaceId: "ws-t49", git: gitPort(), files });
  const decision = gate.evaluate(bundle());
  expect(decision.hardGatePass).toBe(true);
  expect(decision.decision).toBe("proceed-to-w2");
  expect(decision.reportSha256).toMatch(/^[a-f0-9]{64}$/u);
  const stopped = gate.evaluate(bundle({
    integrity: { ...bundle().integrity, recoveryRate: 0 },
    efficiency: { ...bundle().efficiency, realizedNetMedian: 100, ingressTokenMedianDelta: -0.9 },
  }));
  expect(stopped.decision).toBe("stop");
  expect(stopped.hardGatePass).toBe(false);
  const masked = gate.evaluate(bundle({ continuation: { environmentSuccess: false } }));
  expect(masked.decision).toBe("stop");
  const digest = await gate.writeImmutableBundle(bundle(), "/out");
  expect(digest).toBe(decision.reportSha256);
  expect(files.blobs.has(`/out/${digest}/bundle.json`)).toBe(true);
  return { ok: true as const, task: "T49" as const, decision };
}

describe("T49 Immutable report and gate engine", () => {
  it("immutable_report_and_gate_engine", async () => {
    await expect(runT49Fixture()).resolves.toMatchObject({ ok: true, task: "T49" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createGateEngine({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_GATE_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed bundles", () => {
    expect(() => engine().evaluate({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_GATE_INPUT_INVALID" }),
    );
  });

  it("replays equal decisions for the same bundle", () => {
    const gate = engine();
    expect(gate.evaluate(bundle())).toEqual(gate.evaluate(bundle()));
  });

  it("denies writes for another workspace", async () => {
    await expect(engine().writeImmutableBundle(bundle({ workspaceId: "ws-other" }), "/out")).rejects.toMatchObject({
      code: "PCR_GATE_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before writing the bundle", async () => {
    let writes = 0;
    const gate = createGateEngine({
      workspaceId: "ws-t49",
      git: gitPort(),
      files: {
        async mkdir() { writes += 1; },
        async writeFile() { writes += 1; },
      },
    });
    await expect(gate.writeImmutableBundle({ ...bundle(), signal: AbortSignal.abort() }, "/out")).rejects.toThrow();
    expect(writes).toBe(0);
  });
});
