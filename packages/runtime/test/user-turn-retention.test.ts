import { describe, expect, it } from "vitest";

import { blobId, domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createUserTurnRetention } from "@pcr/runtime";

const cursor = createRuntimeCursor({
  workspacePath: "/tmp/pcr-retention",
  sessionId: "session-retain",
  leafId: "leaf-retain",
  lineageEntryIds: ["root", "leaf-retain"],
  modelKey: "openclaw/Qwen3.8-27B-WORK",
});

describe("user turn retention", () => {
  it("keeps parser-miss raw turns exact-readable and supersedes later turns", async () => {
    const blobs = new Map<string, Uint8Array>();
    const ledger = new Map<string, { receiptId: string; rawBlobId: ReturnType<typeof blobId>; sourceClass: "authenticated-user"; cursor: typeof cursor }>();
    const store = {
      async get(_cursor: typeof cursor, receiptId: string) {
        return ledger.get(receiptId) ?? null;
      },
    };
    const blobStore = {
      async put() { throw new Error("unused"); },
      async read(_cursor: typeof cursor, ref: string) {
        const bytes = blobs.get(ref);
        if (!bytes) throw new Error("missing");
        return bytes;
      },
    };
    const retention = createUserTurnRetention({ cursor, ledger: store, blobs: blobStore });
    const firstRef = blobId(`blob_${domainHash("retain-1", "keep the cache invariant")}`);
    blobs.set(firstRef, Buffer.from("keep the cache invariant"));
    const first = {
      receiptId: "receipt-1",
      operationId: "op-1",
      cursor,
      rawTextHash: domainHash("text", "keep the cache invariant"),
      rawBlobId: firstRef,
      utf8Bytes: 24,
      sourceClass: "authenticated-user" as const,
      capturedAt: 1,
      status: "pending" as const,
    };
    ledger.set(first.receiptId, first);
    const retained = await retention.retain(cursor, first);
    expect(retained.rawText).toContain("cache invariant");
    const read = await retention.exactRead(cursor, "receipt-1");
    expect(read.rawText).toBe("keep the cache invariant");
    const other = { ...cursor, sessionId: "other" };
    await expect(retention.exactRead(other, "receipt-1")).rejects.toMatchObject({
      code: "PCR_USER_TURN_RETENTION_SCOPE_MISMATCH",
    });
  });
});
