import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertFailedSampleRetained,
  collectPerArmRawEvidence,
  createGateEngine,
  keepFailedArmEvidence,
  scrubSecretsWithProvenance,
  sealRunBundle,
  verifyRawRunBundle,
  verifyRunBundle,
  writeArmArtifactDir,
  type RunBundle,
} from "@pcr/benchmark";

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

  it("rejects preview-only raw artifacts on writeImmutableBundle", async () => {
    const engine = createGateEngine({
      workspaceId: "ws-report",
      git: { async status() { return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false }; } },
      files: { async mkdir() {}, async writeFile() {} },
    });
    await expect(engine.writeImmutableBundle({
      ...sample(),
      rawArtifacts: {
        sessionJsonl: "preview-only",
        storeSnapshotSha256: "a".repeat(64),
        workspaceManifestSha256: "b".repeat(64),
        configIdentity: "cfg",
        modelIdentity: "openclaw/Qwen3.8-27B-WORK",
        providerIdentity: "openclaw",
        rawReport: { gate: "w1-early-net-value" },
        decision: { decision: "keep-pi-native" },
      },
    }, "out")).rejects.toThrowError(expect.objectContaining({ code: "PCR_BUNDLE_PREVIEW_ONLY" }));
  });

  it("rejects a preview-only raw bundle", () => {
    expect(() => verifyRawRunBundle({
      sessionJsonl: "preview-only",
      storeSnapshotSha256: "a".repeat(64),
      workspaceManifestSha256: "b".repeat(64),
      configIdentity: "cfg",
      modelIdentity: "openclaw/Qwen3.8-27B-WORK",
      providerIdentity: "openclaw",
      rawReport: { gate: "w1-early-net-value" },
      decision: { decision: "keep-pi-native" },
    })).toThrowError(expect.objectContaining({ code: "PCR_BUNDLE_PREVIEW_ONLY" }));
  });

  it("scrubs secrets while keeping hash provenance and retains failed arm samples", () => {
    const secret = "sk-live-w2-omit-ct-00";
    const scrubbed = scrubSecretsWithProvenance(`token ${secret} in jsonl ${secret}`, [secret]);
    expect(scrubbed.text).not.toContain(secret);
    expect(scrubbed.text).toContain(`[redacted:sha256:${createHash("sha256").update(secret, "utf8").digest("hex")}]`);
    expect(scrubbed.provenance).toEqual([{ sha256: createHash("sha256").update(secret, "utf8").digest("hex"), count: 2 }]);
    const root = mkdtempSync(join(tmpdir(), "pcr-raw-arm-"));
    const cwd = join(root, "ws");
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, "note.txt"), "workspace-bytes\n");
    const sessionFile = join(root, "session.jsonl");
    writeFileSync(sessionFile, `${"{\"type\":\"session\",\"id\":\"s\"}\n".repeat(30)}{"type":"compaction","firstKeptEntryId":"e1"}\n{"type":"usage","requestId":"req_1"}\n`);
    const raw = collectPerArmRawEvidence({
      arm: "B0",
      failed: true,
      sessionFile,
      cwd,
      stderr: "provider timeout",
    });
    expect(raw.retained).toBe(true);
    expect(raw.sessionJsonl.length).toBeGreaterThan(400);
    expect(keepFailedArmEvidence(raw).failed).toBe(true);
    assertFailedSampleRetained(root);
    expect(() => keepFailedArmEvidence({ ...raw, retained: false })).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_FAILED_SAMPLE_DELETED" }),
    );
    const armDir = join(root, "arms", "B0");
    writeArmArtifactDir(armDir, raw);
    expect(existsSync(join(armDir, "FAILED"))).toBe(true);
    expect(existsSync(join(armDir, "workspace.sha256"))).toBe(true);
    expect(existsSync(join(armDir, "store.sha256"))).toBe(true);
  });
});

