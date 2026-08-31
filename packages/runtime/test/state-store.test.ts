import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  openWorkspaceSqliteStore,
  openWorkspaceStateStore,
  StateStoreError,
} from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const value = mkdtempSync(join(tmpdir(), "pcr-state-store-"));
  roots.push(value);
  return value;
}

describe("persistent directive/claim/continuity store", () => {
  it("restarts with the same active heads, excludes superseded rows, and denies cross-scope reads", async () => {
    const root = dataRoot();
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-state",
      leafId: "leaf-state",
      lineageEntryIds: ["root", "leaf-state"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const other = { ...cursor, sessionId: "session-other" };
    const database = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    const store = openWorkspaceStateStore({ database });
    const first = {
      directiveId: "dir_one",
      userTurnId: "turn_1",
      exactQuote: "use sqlite",
      quoteHash: "a".repeat(64),
      utf8ByteRange: { start: 0, end: 9 },
      utf16Range: { start: 0, end: 9 },
      codePointRange: { start: 0, end: 9 },
      kind: "constraint" as const,
      polarity: "must" as const,
      key: "store",
      value: "memory",
      status: "active" as const,
      cursor,
    };
    await store.putDirective(first);
    await store.putDirective({
      ...first,
      directiveId: "dir_two",
      value: "sqlite",
      status: "active",
    });
    await store.putDirective({
      ...first,
      status: "superseded",
      supersededBy: "dir_two",
    });
    await store.putClaim({
      claimId: "cl_dir_two",
      cursor,
      key: "store",
      polarity: "must",
      status: "active",
      value: "sqlite",
      authority: "inform",
    });
    const continuity = {
      revisionId: "rev_1",
      parentRevisionId: null,
      contentHash: "b".repeat(64),
      cursor,
      taskFronts: { active: [], parked: [], completed: [], superseded: [] },
      nextSafeActions: [],
    };
    await store.putContinuity(continuity);
    const before = await store.readSnapshot(cursor);
    const active = before.directives.filter((row) => row.status === "active").map((row) => row.directiveId);
    expect(active).toEqual(["dir_two"]);
    await database.close();

    const reopened = await openWorkspaceSqliteStore({
      dataRoot: root,
      workspaceId: cursor.workspaceId,
      busyTimeoutMs: 1_000,
    });
    try {
      const restored = openWorkspaceStateStore({ database: reopened });
      const after = await restored.readSnapshot(cursor);
      expect(after.directives.filter((row) => row.status === "active").map((row) => row.directiveId)).toEqual(["dir_two"]);
      expect(after.claims.map((row) => row.value)).toEqual(["sqlite"]);
      expect(after.continuity?.contentHash).toBe(continuity.contentHash);
      expect(await restored.listDirectives(other)).toEqual([]);
      expect(after.directives.some((row) => row.directiveId === "dir_two")).toBe(true);
    } finally {
      await reopened.close();
    }
  });
});
