import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, configHashOf } from "../../src/config.js";
import { createHistoryIndex } from "../../src/history/index.js";
import { searchHistory } from "../../src/history/search.js";
import { SearchSnapshotStore, SEARCH_SNAPSHOT_LIMITS } from "../../src/history/page-snapshots.js";
import { independentBranch } from "../../src/testing.js";

describe("T08 search", () => {
  it("authorizes before limit and does not expand empty results", async () => {
    const fx = independentBranch();
    const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, leafId: "b", visibleEntryIds: new Set(["b"]) };
    await idx.upsertBranch(scope, fx.entries);
    const getEntry = (id: string) => fx.entries.find((e) => e.id === id);
    const result = await searchHistory({
      scope,
      query: "keep",
      limit: 1,
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
      snapshots: new SearchSnapshotStore(SEARCH_SNAPSHOT_LIMITS),
      configHash: configHashOf(DEFAULT_CONFIG),
    });
    expect(result.hits?.every((h) => h.entryId === "b" || scope.visibleEntryIds.has(h.entryId))).toBe(true);
    const empty = await searchHistory({
      scope,
      query: "zzz-no-such",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
      snapshots: new SearchSnapshotStore(SEARCH_SNAPSHOT_LIMITS),
      configHash: configHashOf(DEFAULT_CONFIG),
    });
    expect(empty.hits ?? []).toEqual([]);
    await idx.close();
  });

  it("rejects a mismatched search cursor instead of restarting page 1", async () => {
    const fx = independentBranch();
    const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
    const snapshots = new SearchSnapshotStore(SEARCH_SNAPSHOT_LIMITS);
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, leafId: "b", visibleEntryIds: new Set(fx.visibleIds) };
    await idx.upsertBranch(scope, fx.entries);
    const getEntry = (id: string) => fx.entries.find((e) => e.id === id);
    const first = await searchHistory({
      scope,
      query: "keep",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
      snapshots,
      configHash: configHashOf(DEFAULT_CONFIG),
    });
    const stale = await searchHistory({
      scope,
      query: "start",
      cursor: first.nextCursor ?? first.cursor ?? "not-a-cursor",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
      snapshots,
      configHash: configHashOf(DEFAULT_CONFIG),
    });
    expect(stale.code).toBe("stale-cursor");
    await idx.close();
  });
});
