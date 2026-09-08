import { describe, expect, it } from "vitest";
import { createHistoryIndex } from "../../src/history/index.js";
import { independentBranch } from "../../src/testing.js";

describe("T07 index", () => {
  it("indexes authorized text and can rebuild from entries", async () => {
    const fx = independentBranch();
    const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
    const scope = { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, leafId: "b", visibleEntryIds: new Set(fx.visibleIds) };
    await idx.upsertBranch(scope, fx.entries);
    const hits = await idx.search(scope, "http", fx.visibleIds.length, 0);
    expect(hits.some((h) => h.entryId === "b")).toBe(true);
    expect(await idx.revision(scope)).toMatch(/^\d+:\d+$/);
    await idx.close();
  });
});
