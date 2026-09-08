import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { createHistoryIndex } from "../../src/history/index.js";
import { searchHistory } from "../../src/history/search.js";
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
    });
    expect(result.hits?.every((h) => h.entryId === "b" || scope.visibleEntryIds.has(h.entryId))).toBe(true);
    const empty = await searchHistory({
      scope,
      query: "zzz-no-such",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
    });
    expect(empty.hits ?? []).toEqual([]);
    await idx.close();
  });

  it("restarts mismatched cursors from offset 0", async () => {
    const fx = independentBranch();
    const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, leafId: "b", visibleEntryIds: new Set(fx.visibleIds) };
    await idx.upsertBranch(scope, fx.entries);
    const getEntry = (id: string) => fx.entries.find((e) => e.id === id);
    const first = await searchHistory({
      scope,
      query: "keep",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
    });
    const stale = await searchHistory({
      scope,
      query: "start",
      cursor: first.cursor ?? "not-a-cursor",
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry,
    });
    expect(stale.diagnostic).toMatch(/CURSOR_MISMATCH/);
    await idx.close();
  });
});
