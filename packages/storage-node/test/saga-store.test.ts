import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { blobId, domainHash, type RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import type { SagaOperation } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSagaJournal,
  openWorkspaceSqliteStore,
  WORKSPACE_SQLITE_MIGRATIONS,
  type WorkspaceSqliteEvidenceStore,
} from "@pcr/storage-node";
import * as storageNodePublicApi from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function root(label: string): string {
  const value = mkdtempSync(join(tmpdir(), `pcr-saga-${label}-`));
  roots.push(value);
  return value;
}

function cursor(dataRoot: string, overrides: Partial<{
  sessionId: string;
  leafId: string | null;
  lineageEntryIds: string[];
  modelKey: string;
}> = {}): RuntimeCursor {
  return createRuntimeCursor({
    workspacePath: dataRoot,
    sessionId: overrides.sessionId ?? "session-saga",
    leafId: overrides.leafId === undefined ? "leaf-saga" : overrides.leafId,
    lineageEntryIds: overrides.lineageEntryIds ?? ["root", "leaf-saga"],
    modelKey: overrides.modelKey ?? "openclaw/Qwen3.8-27B-WORK",
  });
}

function operation(scope: RuntimeCursor, seed: string, overrides: Partial<SagaOperation> = {}): SagaOperation {
  return {
    operationId: `operation-${seed}`,
    cursor: scope,
    kind: "tool-result",
    sourceContentHash: domainHash("saga-source", seed),
    hostCorrelationId: `tool-call-${seed}`,
    rawBlobId: blobId(`blob_${domainHash("saga-blob", seed)}`),
    configFingerprint: domainHash("saga-config", "v1"),
    ...overrides,
  };
}

async function openDatabase(dataRoot: string, scope: RuntimeCursor, busyTimeoutMs = 1_000) {
  return openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs });
}

async function openJournal(
  database: WorkspaceSqliteEvidenceStore,
  verifyBlob: (scope: RuntimeCursor, ref: SagaOperation["rawBlobId"]) => Promise<void> = async () => {},
) {
  return openWorkspaceSagaJournal({ database, verifyBlob });
}

describe("workspace SQLite Saga journal", () => {
  it("requires the owned database capability and explicit blob verifier", async () => {
    expect("getWorkspaceSqliteAccess" in storageNodePublicApi).toBe(false);
    await expect(openWorkspaceSagaJournal({} as never)).rejects.toMatchObject({
      code: "PCR_SAGA_DEPENDENCY_MISSING",
    });
    const dataRoot = root("dependencies");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    try {
      await expect(openWorkspaceSagaJournal({ database } as never)).rejects.toMatchObject({
        code: "PCR_SAGA_DEPENDENCY_MISSING",
      });
    } finally {
      await database.close();
    }
  });

  it("upgrades an exact V1 database through the current schema without changing the V1 checksum", async () => {
    const dataRoot = root("v1-upgrade");
    const scope = cursor(dataRoot);
    const workspaceRoot = join(dataRoot, scope.workspaceId);
    mkdirSync(workspaceRoot, { recursive: true });
    const path = join(workspaceRoot, "runtime.sqlite");
    const legacy = new DatabaseSync(path);
    const v1 = WORKSPACE_SQLITE_MIGRATIONS[0]!;
    const checksum = domainHash("storage-node-migration", {
      name: v1.name,
      sql: v1.sql,
      version: v1.version,
    });
    legacy.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE schema_migration (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      ${v1.sql}
    `);
    legacy.prepare("INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (1, ?, ?, 1)")
      .run(v1.name, checksum);
    legacy.prepare("INSERT INTO workspace_meta(singleton, workspace_id, created_at) VALUES (1, ?, 1)")
      .run(scope.workspaceId);
    legacy.exec("COMMIT");
    legacy.close();

    const upgraded = await openDatabase(dataRoot, scope);
    try {
      expect(upgraded.getSchemaVersion()).toBe(4);
      const inspection = new DatabaseSync(path, { readOnly: true });
      try {
        expect(inspection.prepare("SELECT checksum FROM schema_migration WHERE version = 1").get()).toEqual({ checksum });
        expect(inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'saga_journal'").get())
          .toEqual({ name: "saga_journal" });
      } finally {
        inspection.close();
      }
    } finally {
      await upgraded.close();
    }
  });

  it("shares the owned workspace connection, applies V2, and verifies a real CAS receipt before prepare", async () => {
    const dataRoot = root("shared");
    const scope = cursor(dataRoot);
    const key = Buffer.alloc(32, 1);
    const blobs = createEncryptedBlobStore({
      dataRoot,
      workspaceId: scope.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("saga-key", key); },
        async get(_workspaceId, keyId) {
          return keyId === "saga-key" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const ref = await blobs.put(scope, Buffer.from("durable before saga"));
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database, async (candidate, blobRef) => {
      await blobs.read(candidate, blobRef, { start: 0, endExclusive: 0 });
    });
    try {
      const record = await journal.prepare(operation(scope, "real", { rawBlobId: ref }));
      expect(record).toMatchObject({ state: "runtime_durable", revision: 1, rawBlobId: ref });
      expect(database.getSchemaVersion()).toBe(4);
      const inspection = new DatabaseSync(database.path, { readOnly: true });
      try {
        expect(inspection.prepare("SELECT name FROM schema_migration ORDER BY version").all()).toEqual([
          { name: "workspace-evidence-v1" },
          { name: "workspace-saga-v2" },
          { name: "workspace-user-turn-v3" },
          { name: "workspace-user-turn-disposition-v4" },
        ]);
      } finally {
        inspection.close();
      }
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("replays exact operations and regenerated operation IDs by full scoped correlation", async () => {
    const dataRoot = root("idempotent");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    let verifications = 0;
    const journal = await openJournal(database, async () => { verifications += 1; });
    try {
      const firstInput = operation(scope, "same");
      const first = await journal.prepare(firstInput);
      expect(await journal.prepare(firstInput)).toEqual(first);
      const regenerated = await journal.prepare({ ...firstInput, operationId: "operation-regenerated" });
      expect(regenerated).toEqual(first);
      expect(verifications).toBe(1);
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("rejects operation and correlation conflicts without overwriting the winner", async () => {
    const dataRoot = root("conflict");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database);
    try {
      const winner = operation(scope, "winner");
      const durable = await journal.prepare(winner);
      await expect(journal.prepare({ ...winner, sourceContentHash: "f".repeat(64) })).rejects.toMatchObject({
        code: "PCR_SAGA_OPERATION_CONFLICT",
      });
      await expect(journal.prepare({
        ...winner,
        operationId: "operation-correlation-conflict",
        rawBlobId: blobId(`blob_${"e".repeat(64)}`),
      })).rejects.toMatchObject({ code: "PCR_SAGA_CORRELATION_CONFLICT" });
      expect(await journal.get(winner.operationId)).toEqual(durable);

      const firstHostOwner = operation(scope, "host-owner-a");
      const secondHostOwner = operation(scope, "host-owner-b");
      await journal.prepare(firstHostOwner);
      await journal.prepare(secondHostOwner);
      await journal.markHostVisible(firstHostOwner.operationId, "shared-host-id");
      await expect(
        journal.markHostVisible(secondHostOwner.operationId, "shared-host-id"),
      ).rejects.toMatchObject({ code: "PCR_SAGA_HOST_CONFLICT" });
      expect(await journal.get(firstHostOwner.operationId)).toMatchObject({
        state: "host_visible",
        hostId: "shared-host-id",
        revision: 2,
      });
      expect(await journal.get(secondHostOwner.operationId)).toMatchObject({
        state: "runtime_durable",
        revision: 1,
      });

      await expect(journal.reconcile({
        cursor: scope,
        configFingerprint: secondHostOwner.configFingerprint,
        entries: [{
          hostId: "shared-host-id",
          hostCorrelationId: secondHostOwner.hostCorrelationId,
          contentHash: secondHostOwner.sourceContentHash,
        }],
      })).rejects.toMatchObject({ code: "PCR_SAGA_HOST_CONFLICT" });
      expect(await journal.get(firstHostOwner.operationId)).toMatchObject({
        state: "host_visible",
        hostId: "shared-host-id",
        revision: 2,
      });
      expect(await journal.get(secondHostOwner.operationId)).toMatchObject({
        state: "runtime_durable",
        revision: 1,
      });
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("leaves no row when blob verification fails or cancellation wins before the transaction", async () => {
    const dataRoot = root("verification");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const rejected = await openJournal(database, async () => { throw new Error("blob missing"); });
    await expect(rejected.prepare(operation(scope, "missing"))).rejects.toThrow("blob missing");
    expect(await rejected.get("operation-missing")).toBeNull();
    await rejected.close();

    const before = new AbortController();
    before.abort();
    const journal = await openJournal(database);
    await expect(journal.prepare(operation(scope, "pre-abort", { signal: before.signal }))).rejects.toMatchObject({
      name: "AbortError",
    });
    const during = new AbortController();
    const cancelling = await openJournal(database, async () => { during.abort(); });
    await expect(cancelling.prepare(operation(scope, "mid-abort", { signal: during.signal }))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(await journal.get("operation-pre-abort")).toBeNull();
    expect(await journal.get("operation-mid-abort")).toBeNull();
    await cancelling.close();
    await journal.close();
    await database.close();
  });

  it("marks host visibility idempotently and repairs acknowledgment to committed exactly once", async () => {
    const dataRoot = root("host-visible");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database);
    const input = operation(scope, "host-visible");
    try {
      await journal.prepare(input);
      await journal.markHostVisible(input.operationId, "host-1");
      await journal.markHostVisible(input.operationId, "host-1");
      await expect(journal.markHostVisible(input.operationId, "host-2")).rejects.toMatchObject({
        code: "PCR_SAGA_HOST_CONFLICT",
      });
      expect(await journal.get(input.operationId)).toMatchObject({ state: "host_visible", hostId: "host-1", revision: 2 });
      const snapshot = {
        cursor: scope,
        configFingerprint: input.configFingerprint,
        entries: [{ hostId: "host-1", hostCorrelationId: input.hostCorrelationId, contentHash: input.sourceContentHash }],
      };
      expect(await journal.reconcile(snapshot)).toMatchObject({
        actions: [expect.objectContaining({ operationId: input.operationId, to: "committed" })],
      });
      expect(await journal.get(input.operationId)).toMatchObject({ state: "committed", revision: 4 });
      expect(await journal.reconcile(snapshot)).toEqual({ actions: [] });
      expect(await journal.get(input.operationId)).toMatchObject({ revision: 4 });
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("keeps missing-host operations recoverable and never invents records for host-only entries", async () => {
    const dataRoot = root("orphan");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database);
    const input = operation(scope, "orphan");
    try {
      await journal.prepare(input);
      const report = await journal.reconcile({
        cursor: scope,
        configFingerprint: input.configFingerprint,
        entries: [{ hostId: "host-only", hostCorrelationId: "unknown-correlation", contentHash: "a".repeat(64) }],
      });
      expect(report.actions).toEqual(expect.arrayContaining([
        expect.objectContaining({ operationId: input.operationId, reason: "host-entry-missing", to: "runtime_durable" }),
        expect.objectContaining({ operationId: "host-only", reason: "host-message-without-runtime-record", to: "absent" }),
      ]));
      expect(await journal.get(input.operationId)).toMatchObject({ state: "runtime_durable", revision: 1 });
      expect(await journal.get("host-only")).toBeNull();
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("fails content conflicts and fences branch, model, and config drift as stale", async () => {
    const dataRoot = root("fencing");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database);
    try {
      const contentConflict = operation(scope, "content-conflict");
      await journal.prepare(contentConflict);
      await journal.reconcile({
        cursor: scope,
        configFingerprint: contentConflict.configFingerprint,
        entries: [{
          hostId: "host-content-conflict",
          hostCorrelationId: contentConflict.hostCorrelationId,
          contentHash: "f".repeat(64),
        }],
      });
      expect(await journal.get(contentConflict.operationId)).toMatchObject({ state: "failed" });

      const hostConflict = operation(scope, "host-conflict");
      await journal.prepare(hostConflict);
      await journal.markHostVisible(hostConflict.operationId, "host-bound");
      await journal.reconcile({
        cursor: scope,
        configFingerprint: hostConflict.configFingerprint,
        entries: [{
          hostId: "host-different",
          hostCorrelationId: hostConflict.hostCorrelationId,
          contentHash: hostConflict.sourceContentHash,
        }],
      });
      expect(await journal.get(hostConflict.operationId)).toMatchObject({ state: "failed", hostId: "host-bound" });

      for (const [seed, snapshotCursor, configFingerprint] of [
        ["leaf-drift", { ...scope, leafId: "leaf-other", lineageHash: "b".repeat(64) }, domainHash("saga-config", "v1")],
        ["model-drift", { ...scope, modelKey: "openclaw/other" }, domainHash("saga-config", "v1")],
        ["config-drift", scope, domainHash("saga-config", "v2")],
      ] as const) {
        const input = operation(scope, seed);
        await journal.prepare(input);
        await journal.reconcile({ cursor: snapshotCursor, configFingerprint, entries: [] });
        expect(await journal.get(input.operationId)).toMatchObject({ state: "stale" });
      }

      const configV1 = operation(scope, "config-retry");
      const configV2 = domainHash("saga-config", "v2");
      await journal.prepare(configV1);
      await journal.reconcile({ cursor: scope, configFingerprint: configV2, entries: [] });
      expect(await journal.get(configV1.operationId)).toMatchObject({ state: "stale" });
      const retried = await journal.prepare({
        ...configV1,
        operationId: "operation-config-retry-v2",
        configFingerprint: configV2,
      });
      expect(retried).toMatchObject({ state: "runtime_durable", revision: 1 });
      await journal.reconcile({
        cursor: scope,
        configFingerprint: configV2,
        entries: [{
          hostId: "host-config-retry",
          hostCorrelationId: configV1.hostCorrelationId,
          contentHash: configV1.sourceContentHash,
        }],
      });
      expect(await journal.get(retried.operationId)).toMatchObject({
        state: "committed",
        hostId: "host-config-retry",
        revision: 3,
      });
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("isolates sessions and rejects the wrong workspace without mutating records", async () => {
    const dataRoot = root("scope");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    let verified = 0;
    const journal = await openJournal(database, async () => { verified += 1; });
    const input = operation(scope, "scope");
    try {
      await journal.prepare(input);
      const otherSession = cursor(dataRoot, { sessionId: "session-other" });
      expect(await journal.reconcile({
        cursor: otherSession,
        configFingerprint: input.configFingerprint,
        entries: [],
      })).toEqual({ actions: [] });
      const otherRoot = root("other-workspace");
      await expect(journal.prepare(operation(cursor(otherRoot), "wrong-workspace"))).rejects.toMatchObject({
        code: "PCR_SAGA_WORKSPACE_MISMATCH",
      });
      expect(verified).toBe(1);
      expect(await journal.get(input.operationId)).toMatchObject({ state: "runtime_durable" });
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("serializes concurrent prepares and returns one correlation winner", async () => {
    const dataRoot = root("concurrent");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database, async () => { await Promise.resolve(); });
    const input = operation(scope, "concurrent");
    try {
      const records = await Promise.all(Array.from({ length: 10 }, (_, index) => journal.prepare({
        ...input,
        operationId: `operation-concurrent-${index}`,
      })));
      expect(new Set(records.map((record) => record.operationId)).size).toBe(1);
      expect(records.every((record) => record.revision === 1)).toBe(true);
    } finally {
      await journal.close();
      await database.close();
    }
  });

  it("recovers a host-visible row after an abrupt process exit and replays without mutation", async () => {
    const dataRoot = root("crash-recovery");
    const scope = cursor(dataRoot);
    const key = Buffer.alloc(32, 4);
    const blobs = createEncryptedBlobStore({
      dataRoot,
      workspaceId: scope.workspaceId,
      maxBlobBytes: 1024,
      keys: {
        async current() { return createWorkspaceBlobKeyMaterial("crash-key", key); },
        async get(_workspaceId, keyId) {
          return keyId === "crash-key" ? createWorkspaceBlobKeyLease(key) : null;
        },
      },
    });
    const rawBlobId = await blobs.put(scope, Buffer.from("crash durable source"));
    const input = operation(scope, "crash-recovery", { rawBlobId });
    const script = join(dataRoot, "crash-saga.ts");
    const payload = join(dataRoot, "crash-saga.json");
    const storageEntry = join(process.cwd(), "packages", "storage-node", "src", "index.ts");
    writeFileSync(payload, JSON.stringify({ dataRoot, scope, input }));
    writeFileSync(script, `
      import { readFileSync } from "node:fs";
      import { createEncryptedBlobStore, createWorkspaceBlobKeyLease, createWorkspaceBlobKeyMaterial, openWorkspaceSagaJournal, openWorkspaceSqliteStore } from ${JSON.stringify(storageEntry)};
      const { dataRoot, scope, input } = JSON.parse(readFileSync(process.argv[2], "utf8"));
      const key = Buffer.alloc(32, 4);
      const blobs = createEncryptedBlobStore({
        dataRoot,
        workspaceId: scope.workspaceId,
        maxBlobBytes: 1024,
        keys: {
          async current() { return createWorkspaceBlobKeyMaterial("crash-key", key); },
          async get(_workspaceId, keyId) { return keyId === "crash-key" ? createWorkspaceBlobKeyLease(key) : null; },
        },
      });
      const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1000 });
      const journal = await openWorkspaceSagaJournal({
        database,
        async verifyBlob(candidate, ref) { await blobs.read(candidate, ref, { start: 0, endExclusive: 0 }); },
      });
      await journal.prepare(input);
      await journal.markHostVisible(input.operationId, "host-after-crash");
      process.kill(process.pid, "SIGKILL");
    `);
    const crashed = spawnSync(join(process.cwd(), "node_modules", ".bin", "jiti"), [script, payload], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(crashed.signal).toBe("SIGKILL");

    const snapshot = {
      cursor: scope,
      configFingerprint: input.configFingerprint,
      entries: [{
        hostId: "host-after-crash",
        hostCorrelationId: input.hostCorrelationId,
        contentHash: input.sourceContentHash,
      }],
    };
    const reopened = await openDatabase(dataRoot, scope);
    const recovered = await openJournal(reopened, async (candidate, ref) => {
      await blobs.read(candidate, ref, { start: 0, endExclusive: 0 });
    });
    expect(await recovered.get(input.operationId)).toMatchObject({ state: "host_visible", revision: 2 });
    expect(await recovered.reconcile(snapshot)).toMatchObject({
      actions: [expect.objectContaining({ operationId: input.operationId, to: "committed" })],
    });
    expect(await recovered.get(input.operationId)).toMatchObject({ state: "committed", revision: 4 });
    await recovered.close();
    await reopened.close();

    const replayDatabase = await openDatabase(dataRoot, scope);
    const replayJournal = await openJournal(replayDatabase);
    expect(await replayJournal.reconcile(snapshot)).toEqual({ actions: [] });
    expect(await replayJournal.get(input.operationId)).toMatchObject({ state: "committed", revision: 4 });
    await replayJournal.close();
    await replayDatabase.close();
  });

  it("maps SQLite lock waits, preserves the shared evidence owner, and fails after close", async () => {
    const dataRoot = root("busy");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope, 10);
    const journal = await openJournal(database);
    const locker = new DatabaseSync(database.path);
    locker.exec("BEGIN IMMEDIATE");
    try {
      await expect(journal.prepare(operation(scope, "busy"))).rejects.toMatchObject({ code: "PCR_SAGA_STORAGE_BUSY" });
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
    await journal.close();
    await expect(journal.get("operation-busy")).rejects.toMatchObject({ code: "PCR_SAGA_CLOSED" });
    expect(database.getSchemaVersion()).toBe(4);
    const liveJournal = await openJournal(database);
    await database.close();
    await expect(liveJournal.get("operation-busy")).rejects.toMatchObject({ code: "PCR_SAGA_CLOSED" });
    await liveJournal.close();
  });

  it("rejects duplicate host snapshot identities before entering a transaction", async () => {
    const dataRoot = root("snapshot-invalid");
    const scope = cursor(dataRoot);
    const database = await openDatabase(dataRoot, scope);
    const journal = await openJournal(database);
    try {
      await expect(journal.reconcile({
        cursor: scope,
        configFingerprint: domainHash("saga-config", "v1"),
        entries: [
          { hostId: "same", hostCorrelationId: "a", contentHash: "a".repeat(64) },
          { hostId: "same", hostCorrelationId: "b", contentHash: "b".repeat(64) },
        ],
      })).rejects.toMatchObject({ code: "PCR_SAGA_INPUT_INVALID" });
    } finally {
      await journal.close();
      await database.close();
    }
  });
});
