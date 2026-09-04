import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertFailedSampleRetained,
  assertRunEpoch,
  collectPerArmRawEvidence,
  createGateEngine,
  keepFailedArmEvidence,
  hashRunEpoch,
  hashRunBundle,
  hashArtifactBytes,
  scrubSecretsWithProvenance,
  sealRunBundle,
  verifyRawRunBundle,
  verifyRunBundle,
  verifyRunBundleBytes,
  verifyArtifactManifest,
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
  it("seals one run epoch and rejects mismatched resume state", () => {
    const epoch = hashRunEpoch({
      head: "c".repeat(40), packageSha256: "a".repeat(64), model: "model",
      provider: "provider", corpus: "corpus", scorer: "scorer", config: "config",
    });
    expect(epoch).toMatch(/^[a-f0-9]{64}$/u);
    expect(() => assertRunEpoch(epoch, epoch)).not.toThrow();
    expect(() => assertRunEpoch(epoch, "b".repeat(64))).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_TAMPERED" }),
    );
  });

  it("separates canonical JSON and artifact byte hashes", () => {
    const canonical = hashRunBundle({ value: 1, whitespace: "stable" });
    expect(hashRunBundle(JSON.parse(JSON.stringify({ value: 1, whitespace: "stable" })))).toBe(canonical);
    expect(hashArtifactBytes('{"value":1,"whitespace":"stable"}')).not.toBe(
      hashArtifactBytes('{ "value": 1, "whitespace": "stable" }'),
    );
    expect(hashRunBundle({ value: 2, whitespace: "stable" })).not.toBe(canonical);
  });

  it("verifies paired report manifests instead of accepting arm-only evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-paired-report-"));
    try {
      const report = { runId: "paired-test", sample: { completedPairs: 1 } };
      const reportBytes = `${JSON.stringify(report)}\n`;
      const byteHash = createHash("sha256").update(reportBytes, "utf8").digest("hex");
      const canonicalHash = createHash("sha256").update(JSON.stringify(report), "utf8").digest("hex");
      writeFileSync(join(root, "report.json"), reportBytes);
      writeFileSync(join(root, "run-manifest.json"), JSON.stringify({
        artifactBytesSha256: byteHash,
        canonicalJsonSha256: canonicalHash,
        files: { "report.json": byteHash },
      }));
      const verifier = join(process.cwd(), "scripts/benchmark/verify_run_bundle.py");
      expect(execFileSync("python3", [verifier, root], { encoding: "utf8" })).toContain("ok");
      writeFileSync(join(root, "report.json"), `${reportBytes} `);
      expect(() => execFileSync("python3", [verifier, root], { encoding: "utf8", stdio: "pipe" })).toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("writes manifest hashes that verify the canonical bundle bytes", async () => {
    const writes = new Map<string, Buffer>();
    const engine = createGateEngine({
      workspaceId: "ws-report",
      git: { async status() { return { commit: "c".repeat(40), diffHash: EMPTY_DIFF, dirty: false }; } },
      files: {
        async mkdir() {},
        async writeFile(path: string, data: Buffer) { writes.set(path, Buffer.from(data)); },
      },
    });
    const report = await engine.writeImmutableBundle(sample(), "/tmp/ignored-by-fake-store");
    const bundlePath = [...writes.keys()].find((path) => path.endsWith("/bundle.json"));
    const manifestPath = [...writes.keys()].find((path) => path.endsWith("/manifest.json"));
    expect(bundlePath).toBeDefined();
    expect(manifestPath).toBeDefined();
    const manifest = JSON.parse(writes.get(manifestPath!)!.toString("utf8")) as { artifactBytesSha256: string; canonicalJsonSha256: string };
    const bytes = writes.get(bundlePath!)!.toString("utf8");
    expect(manifest.artifactBytesSha256).toBe(hashArtifactBytes(bytes));
    expect(manifest.canonicalJsonSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(verifyArtifactManifest(bytes, manifest)).toEqual(manifest);
    expect(() => verifyArtifactManifest(`${bytes} `, manifest)).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_TAMPERED" }),
    );
    expect(report).toMatch(/^[a-f0-9]{64}$/u);
  });

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
    expect(() => verifyRunBundle({ ...sealed, artifactBytesSha256: "e".repeat(64) })).toThrowError(
      expect.objectContaining({ code: "PCR_BUNDLE_TAMPERED" }),
    );
    const serialized = JSON.stringify({ bundle: sealed.bundle, decision: sealed.decision });
    expect(() => verifyRunBundleBytes(sealed, serialized)).toThrowError(
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
