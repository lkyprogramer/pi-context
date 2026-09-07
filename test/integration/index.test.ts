import { describe, expect, it } from "vitest";
import { HistoryIndex } from "../../src/history/index.js";
import { independentBranch } from "../../src/testing.js";

describe("T07 index", () => {
  it("indexes authorized text and can rebuild from entries", () => {
    const fx = independentBranch();
    const idx = new HistoryIndex("memory-only");
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, visibleEntryIds: new Set(fx.visibleIds) };
    for (const e of fx.entries) idx.upsert(scope, e);
    const hits = idx.search(scope, "http", fx.visibleIds, 8);
    expect(hits.some((h) => h.entryId === "b")).toBe(true);
    expect(idx.sourceRevision(fx.entries)).toHaveLength(64);
  });
});
