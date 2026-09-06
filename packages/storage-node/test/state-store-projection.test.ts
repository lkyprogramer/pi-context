import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeCursor } from "@pcr/contracts";
import {
  openWorkspaceSqliteStore,
  openWorkspaceStateStore,
  type PersistentClaimRecord,
  type StoredDirectiveRecord,
} from "@pcr/storage-node";

const roots: string[] = [];
const workspaceId = `ws_${"b".repeat(40)}`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-state-projection-"));
  roots.push(value);
  return value;
}

function cursor(overrides: Partial<RuntimeCursor> = {}): RuntimeCursor {
  return {
    workspaceId,
    sessionId: "session-projection",
    leafId: "leaf-projection",
    lineageHash: "c".repeat(64),
    modelKey: "openclaw/Qwen3.8-27B-WORK",
    ...overrides,
  };
}

function directive(scope: RuntimeCursor, directiveId: string): StoredDirectiveRecord {
  return {
    directiveId,
    userTurnId: `turn_${directiveId}`,
    exactQuote: `keep ${directiveId}`,
    quoteHash: "d".repeat(64),
    utf8ByteRange: { start: 0, end: 4 },
    utf16Range: { start: 0, end: 4 },
    codePointRange: { start: 0, end: 4 },
    kind: "constraint",
    polarity: "must",
    status: "active",
    cursor: scope,
  };
}

function claim(scope: RuntimeCursor, claimId: string): PersistentClaimRecord {
  return {
    claimId,
    cursor: scope,
    key: `key_${claimId}`,
    polarity: "must",
    status: "active",
    value: { claimId },
    authority: "inform",
  };
}

describe("directive projection", () => {
  it("upserts one cursor-scoped projection without deleting existing state", async () => {
    const root = dataRoot();
    const scope = cursor();
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    try {
      const store = openWorkspaceStateStore({ database });
      await store.putDirective(directive(scope, "dir_existing"));
      await store.putClaim(claim(scope, "cl_existing"));

      await store.putDirectiveProjection(
        scope,
        [directive(scope, "dir_projection")],
        [claim(scope, "cl_projection")],
      );

      expect((await store.listDirectives(scope)).map((record) => record.directiveId)).toEqual([
        "dir_existing",
        "dir_projection",
      ]);
      expect((await store.listClaims(scope)).map((record) => record.claimId)).toEqual([
        "cl_existing",
        "cl_projection",
      ]);
    } finally {
      await database.close();
    }
  });

  it("keeps projection ordering stable when replay crosses clock ticks", async () => {
    const root = dataRoot();
    const scope = cursor();
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      const store = openWorkspaceStateStore({ database });
      const input = [directive(scope, "dir_z"), directive(scope, "dir_a")];
      await store.putDirectiveProjection(scope, input, []);
      const before = await store.listDirectives(scope);
      let tick = 2000;
      clock.mockImplementation(() => tick++);
      await store.putDirectiveProjection(scope, input, []);
      expect(await store.listDirectives(scope)).toEqual(before);
    } finally {
      clock.mockRestore();
      await database.close();
    }
  });

  it("validates every record before writing any projection row", async () => {
    const root = dataRoot();
    const scope = cursor();
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    try {
      const store = openWorkspaceStateStore({ database });
      await expect(store.putDirectiveProjection(
        scope,
        [
          directive(scope, "dir_valid"),
          { ...directive(scope, "dir_invalid"), quoteHash: "not-a-hash" },
        ],
        [claim(scope, "cl_never_written")],
      )).rejects.toMatchObject({ code: "PCR_STATE_STORE_INPUT_INVALID" });

      expect(await store.listDirectives(scope)).toEqual([]);
      expect(await store.listClaims(scope)).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("rejects a projection ID already owned by another cursor before writing", async () => {
    const root = dataRoot();
    const scope = cursor();
    const other = cursor({ sessionId: "session-other" });
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    try {
      const store = openWorkspaceStateStore({ database });
      await store.putDirective(directive(other, "dir_cross_cursor"));

      await expect(store.putDirectiveProjection(
        scope,
        [directive(scope, "dir_cross_cursor")],
        [claim(scope, "cl_never_written")],
      )).rejects.toMatchObject({ code: "PCR_STATE_STORE_SCOPE_MISMATCH" });

      expect((await store.listDirectives(other)).map((record) => record.directiveId)).toEqual(["dir_cross_cursor"]);
      expect(await store.listDirectives(scope)).toEqual([]);
      expect(await store.listClaims(scope)).toEqual([]);
    } finally {
      await database.close();
    }
  });

  it("rolls back every projection row when SQLite fails after an earlier upsert", async () => {
    const root = dataRoot();
    const scope = cursor();
    const initialized = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    const path = initialized.path;
    await initialized.close();
    const setup = new DatabaseSync(path);
    setup.exec(`
      CREATE TRIGGER reject_projection_directive
      BEFORE INSERT ON directive_record
      WHEN NEW.directive_id = 'dir_sql_failure'
      BEGIN
        SELECT RAISE(ABORT, 'projection trigger failure');
      END;
    `);
    setup.close();

    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId, busyTimeoutMs: 1_000 });
    try {
      const store = openWorkspaceStateStore({ database });
      await expect(store.putDirectiveProjection(
        scope,
        [directive(scope, "dir_before_failure"), directive(scope, "dir_sql_failure")],
        [claim(scope, "cl_after_failure")],
      )).rejects.toMatchObject({ code: "PCR_STATE_STORE_STORAGE_FAILURE" });

      expect(await store.listDirectives(scope)).toEqual([]);
      expect(await store.listClaims(scope)).toEqual([]);
    } finally {
      await database.close();
    }
  });
});
