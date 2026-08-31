import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { emptyContinuityRevision, createRuntimeCursor } from "@pcr/core";
import { assembleRuntimeSnapshot, createRuntimeSnapshotTransaction } from "@pcr/runtime";
import { openWorkspaceSqliteStore, openWorkspaceStateStore } from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("runtime snapshot transaction", () => {
  it("returns the same snapshot hash across two isolated reads and rejects a stale branch", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-runtime-snapshot-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-snap",
      leafId: "leaf-snap",
      lineageEntryIds: ["root", "leaf-snap"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const state = openWorkspaceStateStore({ database });
    await state.putDirective({
      directiveId: "dir_snap",
      userTurnId: "turn_snap",
      exactQuote: "keep snapshot stable",
      quoteHash: "c".repeat(64),
      utf8ByteRange: { start: 0, end: 20 },
      utf16Range: { start: 0, end: 20 },
      codePointRange: { start: 0, end: 20 },
      kind: "constraint",
      polarity: "must",
      status: "active",
      cursor,
    });
    const tx = createRuntimeSnapshotTransaction({
      async read(scope) {
        if (scope.lineageHash !== cursor.lineageHash) {
          throw Object.assign(new Error("PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH"), {
            code: "PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH",
          });
        }
        const rows = await state.readSnapshot(scope);
        return {
          cursor: rows.cursor,
          directives: rows.directives.filter((row) => row.status === "active"),
          claims: rows.claims,
          continuity: rows.continuity ?? emptyContinuityRevision(scope),
          pointers: rows.pointers,
          sourceEntryIds: rows.sourceEntryIds,
          schemaVersion: rows.schemaVersion,
        };
      },
    });
    try {
      const first = await tx.assemble(cursor);
      const second = await tx.assemble(cursor);
      expect(second.snapshotHash).toBe(first.snapshotHash);
      expect(first.heads.directiveHead).toBe(second.heads.directiveHead);
      const stale = { ...cursor, lineageHash: "d".repeat(64) };
      await expect(tx.assemble(stale)).rejects.toMatchObject({ code: "PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH" });
      const rebuilt = assembleRuntimeSnapshot({
        cursor,
        directives: first.activeDirectives,
        claims: first.claims,
        continuity: first.continuity,
        pointers: first.pointers,
        sourceEntryIds: [first.sourceEntrySpan.first, first.sourceEntrySpan.last].filter(Boolean),
        schemaVersion: first.schemaVersion,
        configFingerprint: first.configFingerprint,
      });
      expect(rebuilt.snapshotHash).toBe(first.snapshotHash);
    } finally {
      await database.close();
    }
  });
});
