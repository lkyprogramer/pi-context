import { expect, it, test } from "vitest";
import { DEFAULT_CONFIG, configHashOf } from "../../src/config.js";
import { createHistoryIndex } from "../../src/history/index.js";
import { searchHistory } from "../../src/history/search.js";
import { readHistory, formatHistoryResult } from "../../src/history/read.js";
import { encodeRef, isFieldRef, refForField } from "../../src/history/refs.js";
import { SearchSnapshotStore, SEARCH_SNAPSHOT_LIMITS } from "../../src/history/page-snapshots.js";
import { user } from "../helpers/context-audit-fixture.js";
import type { NativeEntry, Scope } from "../../src/contracts.js";

function tr(id: string, parent: string | null, text: string): NativeEntry {
  return {
    id,
    parentId: parent,
    type: "message",
    message: { role: "toolResult", toolCallId: `c-${id}`, toolName: "bash", isError: false, content: [{ type: "text", text }] },
  };
}

function store(): SearchSnapshotStore {
  return new SearchSnapshotStore(SEARCH_SNAPSHOT_LIMITS);
}

test("read cursor is bound to a specific field", () => {
  const entries = [user("a", null, "abcdefghij"), user("b", "a", "0123456789")];
  const scope = { workspaceId: "w", sessionId: "s", leafId: "b", visibleEntryIds: new Set(["a", "b"]) };
  const a = refForField(scope, entries[0]!, 0), b = refForField(scope, entries[1]!, 0);
  if (!isFieldRef(a) || !isFieldRef(b)) throw new Error("invalid fixture");
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const budget = { maxBytes: 4, maxTokens: 100, estimateKind: "character-estimate" as const };
  const first = readHistory({ scope, ref: encodeRef(a), budget, getEntry });
  expect(JSON.stringify(formatHistoryResult(first).content)).toContain(first.nextCursor!);
  const second = readHistory({ scope, ref: encodeRef(b), cursor: first.nextCursor, budget, getEntry });
  expect(second.code).toBe("stale-cursor");
});

it("search snapshot pages without auto-reset on a different query", async () => {
  const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
  const snapshots = store();
  const entries = [1, 2, 3, 4].map((n) => tr(`e${n}`, n === 1 ? null : `e${n - 1}`, `needle page ${n}`));
  const scope: Scope = {
    workspaceId: "w",
    sessionId: "S",
    leafId: "e4",
    visibleEntryIds: new Set(entries.map((e) => e.id)),
  };
  await idx.upsertBranch(scope, entries);
  const getEntry = (id: string) => entries.find((e) => e.id === id);
  const configHash = configHashOf(DEFAULT_CONFIG);
  const first = await searchHistory({
    scope,
    query: "needle",
    limit: 2,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
  });
  expect(first.hits).toHaveLength(2);
  expect(first.nextCursor).toBeTruthy();
  expect(JSON.stringify(formatHistoryResult(first).content)).toContain(first.nextCursor!);
  const second = await searchHistory({
    scope,
    query: "needle",
    limit: 2,
    cursor: first.nextCursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
  });
  expect(second.hits).toHaveLength(2);
  const ids = [...(first.hits ?? []), ...(second.hits ?? [])].map((h) => h.entryId);
  expect(new Set(ids).size).toBe(4);
  const mismatched = await searchHistory({
    scope,
    query: "page",
    limit: 2,
    cursor: first.nextCursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
  });
  expect(mismatched.code).toBe("stale-cursor");
  expect(mismatched.hits ?? []).toEqual([]);
  const laterLeaf: Scope = { ...scope, leafId: "e4", visibleEntryIds: new Set([...scope.visibleEntryIds, "tail"]) };
  const advanced = await searchHistory({
    scope: laterLeaf,
    query: "needle",
    limit: 2,
    cursor: first.nextCursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
  });
  expect(advanced.code).toBe("ok");
  expect(advanced.hits).toHaveLength(2);
  const sibling: Scope = { ...scope, leafId: "other", visibleEntryIds: new Set(["other"]) };
  const diverged = await searchHistory({
    scope: sibling,
    query: "needle",
    limit: 2,
    cursor: first.nextCursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
  });
  expect(diverged.code).toBe("stale-cursor");
  const expired = await searchHistory({
    scope,
    query: "needle",
    limit: 2,
    cursor: first.nextCursor,
    index: idx,
    config: DEFAULT_CONFIG,
    getEntry,
    snapshots,
    configHash,
    nowMs: Date.now() + SEARCH_SNAPSHOT_LIMITS.ttlMs + 1,
  });
  expect(expired.code).toBe("stale-cursor");
  await idx.close();
});
