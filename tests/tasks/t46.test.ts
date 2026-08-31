import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createIntegrityScorer, type IntegritySample } from "@pcr/benchmark";

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const RAW = "FULL RAW LOG\nERROR EADDRINUSE";
const HASH = sha256(RAW);
const CURSOR = {
  workspaceId: "ws-t46",
  sessionId: "session-t46",
};

function sample(overrides: Partial<IntegritySample> = {}): IntegritySample {
  return {
    workspaceId: "ws-t46",
    sessionId: "session-t46",
    directives: { expected: ["do not deploy"], observed: ["do not deploy"] },
    pairs: {
      calls: [{ toolCallId: "c1", toolName: "bash" }],
      results: [{ toolCallId: "c1", toolName: "bash" }],
    },
    recoveries: [{ blobId: "blob_1", expectedSha256: HASH, expectedBytes: RAW.length }],
    hashes: { first: "a".repeat(64), second: "a".repeat(64) },
    ...overrides,
  };
}

function memoryBlobs(store: Record<string, { bytes: Uint8Array; workspaceId: string }>) {
  return {
    async read(scope: { workspaceId: string }, blobId: string) {
      const row = store[blobId];
      if (!row) throw Object.assign(new Error("missing"), { code: "PCR_BLOB_NOT_FOUND" });
      if (row.workspaceId !== scope.workspaceId) {
        throw Object.assign(new Error("denied"), { code: "PCR_RETRIEVAL_SCOPE_DENIED" });
      }
      return row.bytes;
    },
  };
}

async function runT46Fixture() {
  const scorer = createIntegrityScorer({
    blobs: memoryBlobs({ blob_1: { bytes: Buffer.from(RAW, "utf8"), workspaceId: "ws-t46" } }),
  });
  const score = await scorer.score(sample());
  expect(score).toEqual({
    directiveCoverage: 1,
    toolPairViolations: 0,
    recoveryRate: 1,
    deterministicHashStable: true,
  });
  const leakOnly = await scorer.score(sample({
    recoveries: [{ blobId: "blob_1", expectedSha256: HASH, expectedBytes: RAW.length, mustOmitLeak: true }],
  }));
  expect(leakOnly.recoveryRate).toBe(1);
  const unpaired = await scorer.score(sample({
    pairs: { calls: [{ toolCallId: "c1", toolName: "bash" }], results: [] },
  }));
  expect(unpaired.toolPairViolations).toBe(1);
  const unstable = await scorer.score(sample({
    hashes: { first: "a".repeat(64), second: "b".repeat(64) },
  }));
  expect(unstable.deterministicHashStable).toBe(false);
  return { ok: true as const, task: "T46" as const, score };
}

describe("T46 Observed integrity and recovery scorers", () => {
  it("observed_integrity_and_recovery_scorers", async () => {
    await expect(runT46Fixture()).resolves.toMatchObject({ ok: true, task: "T46" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createIntegrityScorer({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_INTEGRITY_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed score input", async () => {
    const scorer = createIntegrityScorer({ blobs: memoryBlobs({}) });
    await expect(scorer.score({} as never)).rejects.toMatchObject({ code: "PCR_INTEGRITY_INPUT_INVALID" });
  });

  it("replays equal scores for the same sample", async () => {
    const scorer = createIntegrityScorer({
      blobs: memoryBlobs({ blob_1: { bytes: Buffer.from(RAW, "utf8"), workspaceId: "ws-t46" } }),
    });
    const first = await scorer.score(sample());
    const second = await scorer.score(sample());
    expect(second).toEqual(first);
  });

  it("denies recovery from another workspace", async () => {
    const scorer = createIntegrityScorer({
      blobs: memoryBlobs({ blob_1: { bytes: Buffer.from(RAW, "utf8"), workspaceId: "ws-other" } }),
    });
    await expect(scorer.score(sample())).rejects.toMatchObject({ code: "PCR_INTEGRITY_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before reading blobs", async () => {
    let reads = 0;
    const scorer = createIntegrityScorer({
      blobs: {
        async read() {
          reads += 1;
          return Buffer.from(RAW);
        },
      },
    });
    await expect(scorer.score({ ...sample(), signal: AbortSignal.abort() })).rejects.toThrow();
    expect(reads).toBe(0);
  });
});
