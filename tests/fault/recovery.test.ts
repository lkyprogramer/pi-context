import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createRecoveryService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("restart recovery via durable saga", () => {
  it("replays host-visible crash, branch rewind, and duplicate events into non-empty actions", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-fault-recovery-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-fault",
      leafId: "leaf-fault",
      lineageEntryIds: ["root", "leaf-fault"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const key = Buffer.alloc(32, 9);
    const blobs = createEncryptedBlobStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      maxBlobBytes: 4096,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("key-fault", key); },
        async get(_workspaceId, keyId) {
          return keyId === "key-fault" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const bytes = new TextEncoder().encode("tool output");
    const ref = await blobs.put(cursor, bytes);
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const journal = await openWorkspaceSagaJournal({
      database,
      async verifyBlob(scope, blobRef) { await blobs.read(scope, blobRef, { start: 0, endExclusive: 0 }); },
    });
    try {
      const fingerprint = domainHash("fault-config", { k: 1 });
      const hash = domainHash("fault-bytes", "tool output");
      await journal.prepare({
        operationId: "op-fault",
        cursor,
        kind: "tool-result",
        sourceContentHash: hash,
        hostCorrelationId: "tool-call-fault",
        rawBlobId: ref,
        configFingerprint: fingerprint,
      });
      await journal.markHostVisible("op-fault", "host-fault");
      const snapshot = {
        cursor,
        configFingerprint: fingerprint,
        entries: [{
          hostId: "host-fault",
          hostCorrelationId: "tool-call-fault",
          contentHash: hash,
        }],
      };
      const recovery = createRecoveryService({
        cursor,
        sessions: {
          async open() { return {}; },
          async close() {},
        },
        journal,
        candidates: { async invalidate() { return 1; } },
      });
      const first = await recovery.onSessionStart({
        cursor,
        reason: "resume",
        hasRawBlobs: true,
        hostSnapshot: snapshot,
      });
      expect(first.saga.actions.length).toBeGreaterThan(0);
      expect(first.saga.actions.some((item) => item.to === "committed")).toBe(true);
      const duplicate = await recovery.onSessionStart({
        cursor,
        reason: "resume",
        hasRawBlobs: true,
        hostSnapshot: snapshot,
      });
      expect(duplicate.saga.actions).toEqual([]);

      await journal.prepare({
        operationId: "op-fault-rewind",
        cursor,
        kind: "tool-result",
        sourceContentHash: hash,
        hostCorrelationId: "tool-call-rewind",
        rawBlobId: ref,
        configFingerprint: fingerprint,
      });
      await journal.markHostVisible("op-fault-rewind", "host-rewind");
      const rewound = { ...cursor, lineageHash: domainHash("rewound-lineage", "leaf-2") };
      const rewind = await journal.reconcile({
        cursor: rewound,
        configFingerprint: fingerprint,
        entries: [{
          hostId: "host-rewind",
          hostCorrelationId: "tool-call-rewind",
          contentHash: hash,
        }],
      });
      expect(rewind.actions.some((item) => item.to === "stale" || item.reason === "cursor-or-config-stale")).toBe(true);
      expect(ref.startsWith("blob_")).toBe(true);
    } finally {
      await journal.close();
      await database.close();
    }
  });
});
