import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  WORKSPACE_SQLITE_MIGRATIONS,
  openWorkspaceSqliteStore,
} from "@pcr/storage-node";

const roots: string[] = [];
const workspaceId = `ws_${"a".repeat(40)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function root(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-storage-node-t09-"));
  roots.push(value);
  return value;
}

describe("WorkspaceSqliteEvidenceStore schema", () => {
  it("creates the cursor-complete v1 evidence schema without legacy branch defaults", async () => {
    const store = await openWorkspaceSqliteStore({ dataRoot: root(), workspaceId, busyTimeoutMs: 1_000 });
    const path = store.path;
    await store.close();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const columns = db.prepare("PRAGMA table_info(evidence)").all() as Array<{ name: string }>;
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "workspace_id",
        "session_id",
        "leaf_id",
        "lineage_hash",
        "model_key",
        "operation_id",
        "observation_id",
        "raw_blob_id",
        "reducer_id",
        "reducer_revision",
        "value_json",
        "source_refs_json",
        "validity_json",
      ]));
      expect(columns.map((column) => column.name)).not.toContain("branch_scope");
      expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    } finally {
      db.close();
    }
  });

  it("records the immutable migration name and checksum", async () => {
    const store = await openWorkspaceSqliteStore({ dataRoot: root(), workspaceId, busyTimeoutMs: 1_000 });
    const path = store.path;
    await store.close();
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const migrations = db.prepare(
        "SELECT version, name, checksum FROM schema_migration ORDER BY version",
      ).all() as Array<{ version: number; name: string; checksum: string }>;
      expect(migrations).toHaveLength(WORKSPACE_SQLITE_MIGRATIONS.length);
      expect(migrations[0]).toMatchObject({ version: 1, name: "workspace-evidence-v1" });
      expect(migrations[0]?.checksum).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      db.close();
    }
  });

  it("fails closed when a database claims an unsupported future migration", async () => {
    const dataRoot = root();
    const store = await openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 });
    const path = store.path;
    await store.close();
    const db = new DatabaseSync(path);
    db.prepare(
      "INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (99, 'future', ?, 1)",
    ).run("f".repeat(64));
    db.close();
    await expect(openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 })).rejects.toMatchObject({
      code: "PCR_SQLITE_SCHEMA_DRIFT",
    });
  });

  it("rejects migration rows that are not an exact positive contiguous prefix", async () => {
    const dataRoot = root();
    const store = await openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 });
    const path = store.path;
    await store.close();
    const db = new DatabaseSync(path);
    db.prepare(
      "INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (0, 'unknown-zero', ?, 1)",
    ).run("0".repeat(64));
    db.close();
    await expect(openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 })).rejects.toMatchObject({
      code: "PCR_SQLITE_SCHEMA_DRIFT",
    });
  });

  it("maps a bounded cross-connection write lock wait and releases open ownership", async () => {
    const dataRoot = root();
    const seeded = await openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 });
    const path = seeded.path;
    await seeded.close();
    const locker = new DatabaseSync(path);
    locker.exec("BEGIN IMMEDIATE");
    try {
      await expect(openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 10 })).rejects.toMatchObject({
        code: "PCR_SQLITE_BUSY",
      });
    } finally {
      locker.exec("ROLLBACK");
      locker.close();
    }
    const recovered = await openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 });
    await recovered.close();
  });

  it("rolls back a failed DDL migration and can recover after the obstruction is removed", async () => {
    const dataRoot = root();
    const workspaceRoot = join(dataRoot, workspaceId);
    const path = join(workspaceRoot, "runtime.sqlite");
    mkdirSync(workspaceRoot, { recursive: true });
    const obstructed = new DatabaseSync(path);
    obstructed.exec("CREATE TABLE workspace_meta (bad TEXT) STRICT");
    obstructed.close();

    await expect(openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 })).rejects.toMatchObject({
      code: "PCR_SQLITE_FAILURE",
    });
    const inspection = new DatabaseSync(path);
    expect(inspection.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('schema_migration', 'evidence')",
    ).all()).toEqual([]);
    inspection.exec("DROP TABLE workspace_meta");
    inspection.close();

    const recovered = await openWorkspaceSqliteStore({ dataRoot, workspaceId, busyTimeoutMs: 1_000 });
    expect(recovered.getSchemaVersion()).toBe(WORKSPACE_SQLITE_MIGRATIONS.length);
    await recovered.close();
  });
});
