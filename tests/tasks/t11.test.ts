import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { domainHash } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import type { SagaOperation } from "@pcr/runtime";
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

async function runT11Fixture(): Promise<{ ok: true; task: "T11" }> {
  const dataRoot = mkdtempSync(join(tmpdir(), "pcr-t11-red-"));
  roots.push(dataRoot);
  const cursor = createRuntimeCursor({
    workspacePath: dataRoot,
    sessionId: "session-t11",
    leafId: "leaf-t11",
    lineageEntryIds: ["root", "leaf-t11"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const key = Buffer.alloc(32, 11);
  const blobs = createEncryptedBlobStore({
    dataRoot,
    workspaceId: cursor.workspaceId,
    maxBlobBytes: 1024,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("key-t11", key); },
      async get(_workspaceId, keyId) {
        return keyId === "key-t11" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
  const rawBlobId = await blobs.put(cursor, Buffer.from("saga source bytes"));
  const operation: SagaOperation = {
    operationId: "operation-t11",
    cursor,
    kind: "tool-result",
    sourceContentHash: domainHash("t11-source", "saga source bytes"),
    hostCorrelationId: "tool-call-t11",
    rawBlobId,
    configFingerprint: domainHash("t11-config", { reducer: "shell-v1" }),
  };
  const database = await openWorkspaceSqliteStore({
    dataRoot,
    workspaceId: cursor.workspaceId,
    busyTimeoutMs: 1_000,
  });
  const journal = await openWorkspaceSagaJournal({
    database,
    async verifyBlob(scope, ref) { await blobs.read(scope, ref, { start: 0, endExclusive: 0 }); },
  });
  try {
    const prepared = await journal.prepare(operation);
    expect(prepared).toMatchObject({ state: "runtime_durable", revision: 1 });
    expect(await journal.prepare(operation)).toEqual(prepared);
    await journal.markHostVisible(operation.operationId, "host-entry-t11");
    const report = await journal.reconcile({
      cursor,
      configFingerprint: operation.configFingerprint,
      entries: [{
        hostId: "host-entry-t11",
        hostCorrelationId: operation.hostCorrelationId,
        contentHash: operation.sourceContentHash,
      }],
    });
    expect(report.actions).toContainEqual(expect.objectContaining({
      operationId: operation.operationId,
      to: "committed",
    }));
    expect(await journal.reconcile({
      cursor,
      configFingerprint: operation.configFingerprint,
      entries: [{
        hostId: "host-entry-t11",
        hostCorrelationId: operation.hostCorrelationId,
        contentHash: operation.sourceContentHash,
      }],
    })).toEqual({ actions: [] });
  } finally {
    await journal.close();
    await database.close();
  }
  return { ok: true, task: "T11" };
}

describe("T11 Cross-store Saga and idempotency", () => {
  it("cross_store_saga_and_idempotency", async () => {
    await expect(runT11Fixture()).resolves.toEqual({ ok: true, task: "T11" });
  });

  it("fails construction without production dependencies", async () => {
    await expect(openWorkspaceSagaJournal({} as never)).rejects.toMatchObject({
      code: "PCR_SAGA_DEPENDENCY_MISSING",
    });
  });
});
