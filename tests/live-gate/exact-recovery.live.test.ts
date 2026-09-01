import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { scoreExactRecovery } from "../../packages/benchmark/src/scoring/integrity.js";
import {
  createEncryptedBlobStore,
  openLocalWorkspaceBlobKeyProvider,
} from "../../packages/storage-node/src/index.js";
import { liveSessionCursor, recoverExactLiveArm } from "./paired-w2-live.js";

const RAW = "FULL RAW LOG\ncache invalidation strategy";
const HASH = createHash("sha256").update(RAW, "utf8").digest("hex");

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

function writeShapedSession(sessionFile: string, cwd: string): void {
  mkdirSync(dirname(sessionFile), { recursive: true });
  const rows = [
    { type: "session", id: "sess-cas", cwd },
    { type: "message", id: "root-1", parentId: null },
    {
      type: "message",
      id: "tool-1",
      parentId: "root-1",
      message: { role: "toolResult", content: [{ type: "text", text: RAW }] },
    },
    { type: "message", id: "tail-1", parentId: "tool-1", message: { role: "user", content: "next" } },
  ];
  writeFileSync(sessionFile, rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
}

describe("exact CAS recovery", () => {
  it("does not treat fromExtension without a CAS read as recovery", async () => {
    const report = await scoreExactRecovery({
      blobs: memoryBlobs({}),
      workspaceId: "ws-a",
      sessionId: "s1",
      wrongWorkspaceId: "ws-b",
      wrongSessionId: "s2",
      pointers: [],
      fromExtension: true,
      mustOmitLeak: false,
    });
    expect(report.recovered).toBe(false);
    expect(report.status).toBe("n/a");
    expect(report.denominator).toBe(0);
    expect(report.reasons).toEqual(expect.arrayContaining(["fromExtension-without-cas-read", "zero-pointer"]));
  });

  it("requires byte length, sha256, and cross-scope denial before recovered=true", async () => {
    const blobs = memoryBlobs({
      blob_1: { bytes: Buffer.from(RAW, "utf8"), workspaceId: "ws-a" },
    });
    const ok = await scoreExactRecovery({
      blobs,
      workspaceId: "ws-a",
      sessionId: "s1",
      wrongWorkspaceId: "ws-b",
      wrongSessionId: "s2",
      pointers: [{ blobId: "blob_1", expectedSha256: HASH, expectedBytes: Buffer.byteLength(RAW) }],
    });
    expect(ok).toMatchObject({
      recovered: true,
      status: "ok",
      recoveredCount: 1,
      denominator: 1,
      crossScopeDenied: true,
    });
    const wrongHash = await scoreExactRecovery({
      blobs,
      workspaceId: "ws-a",
      sessionId: "s1",
      wrongWorkspaceId: "ws-b",
      wrongSessionId: "s2",
      pointers: [{ blobId: "blob_1", expectedSha256: "a".repeat(64), expectedBytes: Buffer.byteLength(RAW) }],
    });
    expect(wrongHash.recovered).toBe(false);
    expect(wrongHash.status).toBe("failed");
    expect(wrongHash.denominator).toBe(1);
    expect(wrongHash.crossScopeDenied).toBe(true);
    const leak = await scoreExactRecovery({
      blobs,
      workspaceId: "ws-a",
      sessionId: "s1",
      wrongWorkspaceId: "ws-b",
      wrongSessionId: "s2",
      pointers: [{ blobId: "blob_1", expectedSha256: HASH, expectedBytes: Buffer.byteLength(RAW) }],
      mustOmitLeak: true,
    });
    expect(leak.recovered).toBe(false);
    expect(leak.reasons).toContain("must-omit-leak");
  });

  it("fails when the wrong cursor can still read the blob", async () => {
    const report = await scoreExactRecovery({
      blobs: {
        async read() {
          return Buffer.from(RAW, "utf8");
        },
      },
      workspaceId: "ws-a",
      sessionId: "s1",
      wrongWorkspaceId: "ws-b",
      wrongSessionId: "s2",
      pointers: [{ blobId: "blob_1", expectedSha256: HASH, expectedBytes: Buffer.byteLength(RAW) }],
    });
    expect(report.recovered).toBe(false);
    expect(report.crossScopeDenied).toBe(false);
    expect(report.reasons.some((reason) => reason.startsWith("cross-scope-allowed"))).toBe(true);
  });

  it("does not count fromHook with no pointers as recovery", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-exact-recovery-"));
    const sessionFile = join(root, "session.jsonl");
    writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "sess-exact", cwd: root })}\n`);
    const report = await recoverExactLiveArm({
      sessionFile,
      cwd: root,
      fromExtension: true,
      mustOmitLeak: false,
      pointerRefs: [],
    });
    expect(report.recovered).toBe(false);
    expect(report.status).toBe("n/a");
    expect(report.denominator).toBe(0);
  });

  it("reads an encrypted product blob with the reconstructed session cursor and denies the wrong workspace", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "pcr-exact-cas-"));
    const sessionFile = join(cwd, "b1", "session.jsonl");
    writeShapedSession(sessionFile, cwd);
    const cursor = liveSessionCursor(sessionFile, cwd);
    expect(cursor.leafId).toBe("tail-1");
    const dataRoot = join(dirname(sessionFile), ".context-runtime");
    mkdirSync(join(dataRoot, cursor.workspaceId), { recursive: true, mode: 0o700 });
    const keys = openLocalWorkspaceBlobKeyProvider({ dataRoot, workspaceId: cursor.workspaceId });
    let ref: string;
    try {
      const blobs = createEncryptedBlobStore({
        dataRoot,
        workspaceId: cursor.workspaceId,
        maxBlobBytes: 8 * 1024 * 1024,
        keys,
      });
      ref = await blobs.put(cursor, Buffer.from(RAW, "utf8"));
    } finally {
      keys.close();
    }
    const ok = await recoverExactLiveArm({
      sessionFile,
      cwd,
      fromExtension: true,
      mustOmitLeak: false,
      pointerRefs: [ref],
    });
    expect(ok.recovered).toBe(true);
    expect(ok.status).toBe("ok");
    expect(ok.denominator).toBe(1);
    expect(ok.crossScopeDenied).toBe(true);

    const other = Buffer.from("not-the-seed-dump");
    const keys2 = openLocalWorkspaceBlobKeyProvider({ dataRoot, workspaceId: cursor.workspaceId });
    let otherRef: string;
    try {
      const store = createEncryptedBlobStore({
        dataRoot,
        workspaceId: cursor.workspaceId,
        maxBlobBytes: 8 * 1024 * 1024,
        keys: keys2,
      });
      otherRef = await store.put(cursor, other);
    } finally {
      keys2.close();
    }
    const failed = await recoverExactLiveArm({
      sessionFile,
      cwd,
      fromExtension: true,
      mustOmitLeak: false,
      pointerRefs: [otherRef],
    });
    expect(failed.recovered).toBe(false);
    expect(failed.status).toBe("failed");

    const foreign = createEncryptedBlobStore({
      dataRoot,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 8 * 1024 * 1024,
      keys: openLocalWorkspaceBlobKeyProvider({ dataRoot, workspaceId: cursor.workspaceId }),
    });
    const wrongCursor = { ...cursor, leafId: null, lineageHash: "a".repeat(64) };
    await expect(foreign.read(wrongCursor, ref as `blob_${string}`)).rejects.toMatchObject({
      code: expect.stringMatching(/SCOPE|MISMATCH/u),
    });
  });
});
