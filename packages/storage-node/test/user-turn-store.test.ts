import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { domainHash, type RuntimeCursor } from "@pcr/contracts";
import { createRuntimeCursor } from "@pcr/core";
import { createUserTurnService } from "@pcr/runtime";
import {
  createEncryptedBlobStore,
  createWorkspaceBlobKeyLease,
  createWorkspaceBlobKeyMaterial,
  openWorkspaceSqliteStore,
  openWorkspaceUserTurnLedger,
  WORKSPACE_SQLITE_MIGRATIONS,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function root(label: string): string {
  const value = mkdtempSync(join(tmpdir(), `pcr-user-turn-${label}-`));
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
    sessionId: overrides.sessionId ?? "session-user-turn",
    leafId: overrides.leafId === undefined ? "leaf-user-turn" : overrides.leafId,
    lineageEntryIds: overrides.lineageEntryIds ?? ["root", "leaf-user-turn"],
    modelKey: overrides.modelKey ?? "openclaw/Qwen3.8-27B-WORK",
  });
}

function blobs(dataRoot: string, scope: RuntimeCursor) {
  const key = Buffer.alloc(32, 12);
  return createEncryptedBlobStore({
    dataRoot,
    workspaceId: scope.workspaceId,
    maxBlobBytes: 4096,
    keys: {
      async current() { return createWorkspaceBlobKeyMaterial("user-turn-key", key); },
      async get(_workspaceId, keyId) {
        return keyId === "user-turn-key" ? createWorkspaceBlobKeyLease(key) : null;
      },
    },
  });
}

function input(scope: RuntimeCursor, seed: string, rawText = `exact-${seed}`) {
  return {
    operationId: `input-${seed}`,
    cursor: scope,
    rawText,
    sourceClass: "authenticated-user" as const,
    capturedAt: 1_700_000_000_000,
  };
}

describe("workspace user turn ledger", () => {
  it("persists exact UTF-8 bytes before linking the real host entry", async () => {
    const dataRoot = root("exact");
    const scope = cursor(dataRoot);
    const blobStore = blobs(dataRoot, scope);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    const service = createUserTurnService({ cursor: scope, blobs: blobStore, ledger });
    try {
      const rawText = "改为版本 7 🚀";
      const receipt = await service.capture(input(scope, "exact", rawText));
      expect(receipt).toMatchObject({
        receiptId: expect.stringMatching(/^receipt_[a-f0-9]{64}$/u),
        rawTextHash: createHash("sha256").update(Buffer.from(rawText)).digest("hex"),
        utf8Bytes: Buffer.byteLength(rawText, "utf8"),
      });
      expect(await blobStore.read(scope, receipt.rawBlobId)).toEqual(Buffer.from(rawText));
      const linked = await service.link(receipt.receiptId, "pi-entry-exact");
      expect(linked).toMatchObject({
        userTurnId: expect.stringMatching(/^user_turn_[a-f0-9]{64}$/u),
        hostMessageId: "pi-entry-exact",
        rawBlobId: receipt.rawBlobId,
      });
      expect(database.getSchemaVersion()).toBe(4);
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("upgrades an exact V2 database without changing V1 or V2 checksums", async () => {
    const dataRoot = root("v2-upgrade");
    const scope = cursor(dataRoot);
    const workspaceRoot = join(dataRoot, scope.workspaceId);
    mkdirSync(workspaceRoot, { recursive: true });
    const path = join(workspaceRoot, "runtime.sqlite");
    const legacy = new DatabaseSync(path);
    const prior = WORKSPACE_SQLITE_MIGRATIONS.slice(0, 2);
    const checksums = prior.map((migration) => domainHash("storage-node-migration", {
      name: migration.name,
      sql: migration.sql,
      version: migration.version,
    }));
    legacy.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE schema_migration (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      ) STRICT;
      ${prior[0]!.sql}
      ${prior[1]!.sql}
    `);
    for (const [index, migration] of prior.entries()) {
      legacy.prepare("INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (?, ?, ?, 1)")
        .run(migration.version, migration.name, checksums[index]);
    }
    legacy.prepare("INSERT INTO workspace_meta(singleton, workspace_id, created_at) VALUES (1, ?, 1)")
      .run(scope.workspaceId);
    legacy.exec("COMMIT");
    legacy.close();

    const upgraded = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    try {
      expect(upgraded.getSchemaVersion()).toBe(4);
      const inspection = new DatabaseSync(path, { readOnly: true });
      try {
        expect(inspection.prepare("SELECT version, checksum FROM schema_migration WHERE version <= 2 ORDER BY version").all())
          .toEqual([{ version: 1, checksum: checksums[0] }, { version: 2, checksum: checksums[1] }]);
        expect(inspection.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user_turn_ledger'").get())
          .toEqual({ name: "user_turn_ledger" });
      } finally {
        inspection.close();
      }
    } finally {
      await upgraded.close();
    }
  });

  it("replays capture and link idempotently and rejects payload or host conflicts", async () => {
    const dataRoot = root("idempotent");
    const scope = cursor(dataRoot);
    const blobStore = blobs(dataRoot, scope);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    const service = createUserTurnService({ cursor: scope, blobs: blobStore, ledger });
    try {
      const first = await service.capture(input(scope, "same"));
      expect(await service.capture(input(scope, "same"))).toEqual(first);
      await expect(service.capture(input(scope, "same", "changed"))).rejects.toMatchObject({
        code: "PCR_USER_TURN_LEDGER_CONFLICT",
      });
      const linked = await service.link(first.receiptId, "host-same");
      expect(await service.link(first.receiptId, "host-same")).toEqual(linked);
      await expect(service.link(first.receiptId, "host-other")).rejects.toMatchObject({
        code: "PCR_USER_TURN_LEDGER_CONFLICT",
      });

      const second = await service.capture(input(scope, "second"));
      await expect(service.link(second.receiptId, "host-same")).rejects.toMatchObject({
        code: "PCR_USER_TURN_LEDGER_HOST_CONFLICT",
      });
      expect(await ledger.get(scope, second.receiptId)).toMatchObject({ receiptId: second.receiptId });

      const handled = await service.capture(input(scope, "handled"));
      expect(await service.abandon(handled.receiptId, "handled")).toMatchObject({ status: "handled" });
      expect(await service.abandon(handled.receiptId, "handled")).toMatchObject({ status: "handled" });
      await expect(service.link(handled.receiptId, "host-handled")).rejects.toMatchObject({
        code: "PCR_USER_TURN_LEDGER_CONFLICT",
      });

      const otherCursor = cursor(dataRoot, {
        leafId: "leaf-other",
        lineageEntryIds: ["root", "leaf-other"],
        modelKey: "openclaw/other-model",
      });
      const otherService = createUserTurnService({ cursor: otherCursor, blobs: blobStore, ledger });
      const other = await otherService.capture(input(otherCursor, "other-cursor"));
      await expect(otherService.link(other.receiptId, "host-same")).rejects.toMatchObject({
        code: "PCR_USER_TURN_LEDGER_HOST_CONFLICT",
      });
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("rejects wrong scope before CAS and keeps cross-session receipts invisible", async () => {
    const dataRoot = root("scope");
    const scope = cursor(dataRoot);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    let puts = 0;
    const service = createUserTurnService({
      cursor: scope,
      blobs: {
        async put() { puts += 1; throw new Error("must not write"); },
        async read() { return new Uint8Array(); },
      },
      ledger,
    });
    try {
      const otherSession = cursor(dataRoot, { sessionId: "session-other" });
      await expect(service.capture(input(otherSession, "wrong"))).rejects.toMatchObject({
        code: "PCR_USER_TURN_SCOPE_MISMATCH",
      });
      expect(puts).toBe(0);
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("leaves no ledger row when cancellation wins after CAS publication", async () => {
    const dataRoot = root("cancel");
    const scope = cursor(dataRoot);
    const realBlobs = blobs(dataRoot, scope);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    const controller = new AbortController();
    const service = createUserTurnService({
      cursor: scope,
      blobs: {
        async put(candidate, bytes) {
          const ref = await realBlobs.put(candidate, bytes);
          controller.abort();
          return ref;
        },
        read: (candidate, ref, range) => realBlobs.read(candidate, ref, range),
      },
      ledger,
    });
    try {
      await expect(service.capture({ ...input(scope, "cancel"), signal: controller.signal })).rejects.toMatchObject({
        name: "AbortError",
      });
      const inspection = new DatabaseSync(database.path, { readOnly: true });
      try {
        expect(inspection.prepare("SELECT COUNT(*) AS count FROM user_turn_ledger").get()).toEqual({ count: 0 });
      } finally {
        inspection.close();
      }
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("recovers pending and linked receipts across independent reopen cycles", async () => {
    const dataRoot = root("reopen");
    const scope = cursor(dataRoot);
    const blobStore = blobs(dataRoot, scope);
    let database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    let ledger = await openWorkspaceUserTurnLedger({ database });
    const receipt = await createUserTurnService({ cursor: scope, blobs: blobStore, ledger }).capture(input(scope, "reopen"));
    await ledger.close();
    await database.close();

    database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    ledger = await openWorkspaceUserTurnLedger({ database });
    const linked = await createUserTurnService({ cursor: scope, blobs: blobStore, ledger })
      .link(receipt.receiptId, "host-reopen");
    await ledger.close();
    await database.close();

    database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    ledger = await openWorkspaceUserTurnLedger({ database });
    try {
      expect(await ledger.get(scope, receipt.receiptId)).toEqual(linked);
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("serializes concurrent duplicate captures to one receipt", async () => {
    const dataRoot = root("concurrent");
    const scope = cursor(dataRoot);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    const service = createUserTurnService({ cursor: scope, blobs: blobs(dataRoot, scope), ledger });
    try {
      const receipts = await Promise.all(Array.from({ length: 8 }, () => service.capture(input(scope, "concurrent"))));
      expect(new Set(receipts.map((receipt) => receipt.receiptId)).size).toBe(1);
    } finally {
      await ledger.close();
      await database.close();
    }
  });

  it("requires the owned database and fails after ledger or database close", async () => {
    await expect(openWorkspaceUserTurnLedger({} as never)).rejects.toMatchObject({
      code: "PCR_USER_TURN_LEDGER_DEPENDENCY_MISSING",
    });
    const dataRoot = root("close");
    const scope = cursor(dataRoot);
    const database = await openWorkspaceSqliteStore({ dataRoot, workspaceId: scope.workspaceId, busyTimeoutMs: 1_000 });
    const ledger = await openWorkspaceUserTurnLedger({ database });
    await ledger.close();
    await expect(ledger.get(scope, "receipt-x")).rejects.toMatchObject({ code: "PCR_USER_TURN_LEDGER_CLOSED" });
    const live = await openWorkspaceUserTurnLedger({ database });
    await database.close();
    await expect(live.get(scope, "receipt-x")).rejects.toMatchObject({ code: "PCR_USER_TURN_LEDGER_CLOSED" });
    await live.close();
  });
});
