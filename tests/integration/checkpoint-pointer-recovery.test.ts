import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BlobRef, RuntimeCursor } from "@pcr/contracts";
import { createCheckpointRenderer, createCheckpointVerifier, createRuntimeCursor, type CompactionSnapshot } from "@pcr/core";
import { createPointerCheck, verifyPointer, verifyPointerBatch, type BlobStore } from "@pcr/runtime";

function cursor(sessionId = "session-pointer-recovery") {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-pointer-recovery",
    sessionId,
    leafId: "leaf-pointer-recovery",
    lineageEntryIds: ["root", "leaf-pointer-recovery"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function memoryBlobs(): BlobStore & { delete(ref: BlobRef): void } {
  const rows = new Map<string, { cursor: RuntimeCursor; bytes: Uint8Array }>();
  return {
    async put(scope, plain) {
      const ref = `blob_${createHash("sha256").update(plain).digest("hex")}` as BlobRef;
      rows.set(ref, { cursor: scope, bytes: Uint8Array.from(plain) });
      return ref;
    },
    async read(scope, ref, range) {
      const row = rows.get(ref);
      if (!row) throw Object.assign(new Error("PCR_BLOB_NOT_FOUND"), { code: "PCR_BLOB_NOT_FOUND" });
      if (row.cursor.workspaceId !== scope.workspaceId || row.cursor.sessionId !== scope.sessionId) {
        throw Object.assign(new Error("PCR_BLOB_SCOPE_MISMATCH"), { code: "PCR_BLOB_SCOPE_MISMATCH" });
      }
      if (range) return row.bytes.slice(range.start, range.endExclusive);
      return row.bytes;
    },
    delete(ref) { rows.delete(ref); },
  };
}

function snapshot(bound: RuntimeCursor, pointers: CompactionSnapshot["pointers"]): CompactionSnapshot {
  return {
    snapshotHash: "a".repeat(64),
    cursor: bound,
    assembledAt: 1,
    reason: "manual",
    directives: [],
    continuity: {
      revisionId: "cr_x",
      parentRevisionId: null,
      contentHash: "c".repeat(64),
      cursor: bound,
      taskFronts: { active: [], parked: [], completed: [], superseded: [] },
      nextSafeActions: [],
    },
    claims: [],
    pointers,
    heads: {
      contextHead: "1".repeat(64),
      directiveHead: "2".repeat(64),
      claimHead: "3".repeat(64),
      continuityHead: "4".repeat(64),
      catalogHead: "5".repeat(64),
    },
  };
}

describe("checkpoint pointer recovery", () => {
  it("recovers in-scope blobs and reports deleted or cross-scope pointers", async () => {
    const bound = cursor();
    const blobs = memoryBlobs();
    const bytes = Uint8Array.from(Buffer.from("recover-me"));
    const ref = await blobs.put(bound, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ok = await verifyPointer({
      cursor: bound,
      blobs,
      ref,
      expectedSha256: sha,
      range: { start: 0, endExclusive: bytes.byteLength },
    });
    expect(ok.ok).toBe(true);
    const other = cursor("session-other");
    const cross = await verifyPointer({ cursor: other, blobs, ref });
    expect(cross.reason).toBe("cross-scope");
    blobs.delete(ref);
    const missing = await verifyPointer({ cursor: bound, blobs, ref });
    expect(missing.reason).toBe("missing");
    const batch = await verifyPointerBatch({
      cursor: bound,
      blobs,
      refs: [{ ref }],
    });
    expect(batch.recoveryRate).toBe(0);
    expect(batch.crossScope).toBe(0);
  });

  it("turns a missing pointer into a checkpoint verifier issue instead of a silent pass", async () => {
    const bound = cursor();
    const blobs = memoryBlobs();
    const renderer = createCheckpointRenderer({ cursor: bound });
    const verifier = createCheckpointVerifier({
      cursor: bound,
      pointers: createPointerCheck(blobs),
    });
    const source = snapshot(bound, [{ ref: `blob_${"e".repeat(64)}`, kind: "evidence" }]);
    const candidate = await renderer.render(source);
    const report = await verifier.verify(source, candidate);
    expect(report.ok).toBe(false);
    expect(report.issues.some((item) => item.code === "PCR_POINTER_UNAVAILABLE")).toBe(true);
  });
});
