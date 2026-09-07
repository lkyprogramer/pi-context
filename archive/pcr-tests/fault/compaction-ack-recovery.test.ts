import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { CompactionJournalError } from "@pcr/runtime";
import { openWorkspaceCompactionJournal, openWorkspaceSqliteStore } from "@pcr/storage-node";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("durable compaction stage/ack", () => {
  it("recovers a staged candidate after reopen and rejects a wrong output hash", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-cstage-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-stage",
      leafId: "leaf-stage",
      lineageEntryIds: ["root", "leaf-stage"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const firstDb = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId: cursor.workspaceId, busyTimeoutMs: 1_000 });
    const journal = openWorkspaceCompactionJournal({ database: firstDb });
    const staged = await journal.stage({
      cursor,
      outputHash: "a".repeat(64),
      firstKeptEntryId: "keep-1",
      payloadJson: JSON.stringify({ firstKeptEntryId: "keep-1" }),
      now: 1,
    });
    expect(staged.state).toBe("staged");
    await firstDb.close();

    const reopened = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId: cursor.workspaceId, busyTimeoutMs: 1_000 });
    const recovered = openWorkspaceCompactionJournal({ database: reopened });
    const pending = await recovered.pending(cursor);
    expect(pending?.outputHash).toBe("a".repeat(64));
    await expect(recovered.ack({
      cursor,
      outputHash: "b".repeat(64),
      firstKeptEntryId: "keep-1",
    })).rejects.toBeInstanceOf(CompactionJournalError);
    const acked = await recovered.ack({
      cursor,
      outputHash: "a".repeat(64),
      firstKeptEntryId: "keep-1",
    });
    expect(acked.state).toBe("acked");
    expect(await recovered.pending(cursor)).toBeNull();
    await reopened.close();
  });

  it("fails the previous staged generation when a newer candidate is staged", async () => {
    const root = mkdtempSync(join(tmpdir(), "pcr-cstage-gen-"));
    roots.push(root);
    const cursor = createRuntimeCursor({
      workspacePath: root,
      sessionId: "session-gen",
      leafId: "leaf-gen",
      lineageEntryIds: ["root", "leaf-gen"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const database = await openWorkspaceSqliteStore({ dataRoot: root, workspaceId: cursor.workspaceId, busyTimeoutMs: 1_000 });
    const journal = openWorkspaceCompactionJournal({ database });
    const first = await journal.stage({
      cursor,
      outputHash: "a".repeat(64),
      firstKeptEntryId: "keep-1",
      payloadJson: JSON.stringify({ firstKeptEntryId: "keep-1" }),
      now: 1,
    });
    const second = await journal.stage({
      cursor,
      outputHash: "c".repeat(64),
      firstKeptEntryId: "keep-2",
      payloadJson: JSON.stringify({ firstKeptEntryId: "keep-2" }),
      now: 2,
    });
    expect(second.generation).toBe(first.generation + 1);
    await expect(journal.ack({
      cursor,
      outputHash: first.outputHash,
      firstKeptEntryId: first.firstKeptEntryId,
    })).rejects.toBeInstanceOf(CompactionJournalError);
    const acked = await journal.ack({
      cursor,
      outputHash: second.outputHash,
      firstKeptEntryId: second.firstKeptEntryId,
    });
    expect(acked.state).toBe("acked");
    expect(acked.generation).toBe(second.generation);
    await database.close();
  });
});
