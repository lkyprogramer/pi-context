import { describe, expect, it } from "vitest";
import { decodeRef } from "../../src/history/refs.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { searchHistory } from "../../src/history/search.js";
import { HistoryIndex } from "../../src/history/index.js";

describe("T20 injection", () => {
  it("rejects path-like refs and FTS operator abuse", () => {
    expect("code" in decodeRef("../../etc/passwd")).toBe(true);
    const idx = new HistoryIndex("memory-only");
    const result = searchHistory({
      scope: { workspaceId: "w", worktreeId: "w", sessionId: "s", leafId: null, visibleEntryIds: new Set(["a"]) },
      query: `${"a".repeat(500)} ^ * OR --`,
      index: idx,
      config: DEFAULT_CONFIG,
      sourceRevision: "a".repeat(64),
      getEntry: () => undefined,
    });
    expect(["denied", "ok"]).toContain(result.code);
  });
});
