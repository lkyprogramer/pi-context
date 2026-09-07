import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { HistoryIndex } from "../../src/history/index.js";
import { searchHistory } from "../../src/history/search.js";
import { independentBranch } from "../../src/testing.js";

describe("T08 search", () => {
  it("authorizes before limit and does not expand empty results", () => {
    const fx = independentBranch();
    const idx = new HistoryIndex("memory-only");
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, visibleEntryIds: new Set(["b"]) };
    for (const e of fx.entries) idx.upsert(scope, e);
    const result = searchHistory({
      scope,
      query: "branch",
      limit: 1,
      index: idx,
      config: DEFAULT_CONFIG,
      sourceRevision: idx.sourceRevision(fx.entries),
    });
    expect(result.hits?.every((h) => h.entryId === "b" || scope.visibleEntryIds.has(h.entryId))).toBe(true);
    const empty = searchHistory({
      scope,
      query: "zzz-no-such",
      index: idx,
      config: DEFAULT_CONFIG,
      sourceRevision: idx.sourceRevision(fx.entries),
    });
    expect(empty.hits ?? []).toEqual([]);
  });

  it("stales cursors after source revision change", () => {
    const fx = independentBranch();
    const idx = new HistoryIndex("memory-only");
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, visibleEntryIds: new Set(fx.visibleIds) };
    const first = searchHistory({
      scope,
      query: "keep",
      index: idx,
      config: DEFAULT_CONFIG,
      sourceRevision: "1".repeat(64),
    });
    const stale = searchHistory({
      scope,
      query: "keep",
      cursor: first.cursor,
      index: idx,
      config: DEFAULT_CONFIG,
      sourceRevision: "2".repeat(64),
    });
    expect(stale.code).toBe("stale-cursor");
  });
});
