import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { BlobRef, ByteRange, RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import type { BlobStore } from "../src/ports.js";
import { createPointerCheck, verifyPointer, verifyPointerBatch } from "../src/evidence/pointer-verify.js";

function cursor(sessionId = "session-pointer") {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-pointer",
    sessionId,
    leafId: "leaf-pointer",
    lineageEntryIds: ["root", "leaf-pointer"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function memoryBlobs(): BlobStore & { delete(ref: BlobRef): void; corrupt(ref: BlobRef): void } {
  const rows = new Map<string, { cursor: RuntimeCursor; bytes: Uint8Array }>();
  return {
    async put(scope, plain) {
      const ref = `blob_${createHash("sha256").update(plain).digest("hex")}` as BlobRef;
      rows.set(ref, { cursor: scope, bytes: Uint8Array.from(plain) });
      return ref;
    },
    async read(scope, ref, range?: ByteRange) {
      const row = rows.get(ref);
      if (!row) throw Object.assign(new Error("PCR_BLOB_NOT_FOUND"), { code: "PCR_BLOB_NOT_FOUND" });
      if (row.cursor.workspaceId !== scope.workspaceId || row.cursor.sessionId !== scope.sessionId) {
        throw Object.assign(new Error("PCR_BLOB_SCOPE_MISMATCH"), { code: "PCR_BLOB_SCOPE_MISMATCH" });
      }
      if (range) {
        if (range.endExclusive > row.bytes.byteLength) {
          throw Object.assign(new Error("PCR_BLOB_RANGE_INVALID"), { code: "PCR_BLOB_RANGE_INVALID" });
        }
        return row.bytes.slice(range.start, range.endExclusive);
      }
      return row.bytes;
    },
    delete(ref) { rows.delete(ref); },
    corrupt(ref) {
      const row = rows.get(ref);
      if (row) row.bytes = Uint8Array.from([9, 9, 9]);
    },
  };
}

describe("pointer verifier", () => {
  it("reads a range, detects corrupt bytes, and reports a deleted pointer", async () => {
    const bound = cursor();
    const blobs = memoryBlobs();
    const bytes = Uint8Array.from(Buffer.from("abcdef"));
    const ref = await blobs.put(bound, bytes);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const ok = await verifyPointer({ cursor: bound, blobs, ref, expectedSha256: sha });
    expect(ok.ok).toBe(true);
    const ranged = await verifyPointer({
      cursor: bound,
      blobs,
      ref,
      range: { start: 0, endExclusive: 3 },
    });
    expect(ranged.byteLength).toBe(3);
    expect(ranged.sha256).toBe(createHash("sha256").update(Buffer.from("abc")).digest("hex"));
    blobs.corrupt(ref);
    const corrupt = await verifyPointer({ cursor: bound, blobs, ref, expectedSha256: sha });
    expect(corrupt.ok).toBe(false);
    expect(corrupt.reason).toBe("hash-mismatch");
    blobs.delete(ref);
    const missing = await verifyPointer({ cursor: bound, blobs, ref, expectedSha256: sha });
    expect(missing.ok).toBe(false);
    expect(missing.reason).toBe("missing");
  });

  it("denies cross-scope reads and honors abort", async () => {
    const bound = cursor();
    const other = cursor("session-other");
    const blobs = memoryBlobs();
    const ref = await blobs.put(bound, Uint8Array.from([1, 2, 3, 4]));
    const cross = await verifyPointer({ cursor: other, blobs, ref });
    expect(cross.ok).toBe(false);
    expect(cross.reason).toBe("cross-scope");
    const report = await verifyPointerBatch({
      cursor: bound,
      blobs,
      refs: [{ ref }],
    });
    expect(report.recoveryRate).toBe(1);
    expect(report.crossScope).toBe(0);
    const controller = new AbortController();
    controller.abort();
    await expect(verifyPointer({ cursor: bound, blobs, ref, signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("fails the checkpoint pointer port on a missing blob", async () => {
    const bound = cursor();
    const blobs = memoryBlobs();
    const check = createPointerCheck(blobs);
    await expect(check.verify(bound, [{ ref: `blob_${"f".repeat(64)}`, kind: "evidence" }])).rejects.toMatchObject({
      code: "PCR_POINTER_UNAVAILABLE",
    });
  });
});
