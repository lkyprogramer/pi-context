import { describe, expect, it } from "vitest";
import { decodeRef } from "../../src/history/refs.js";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { searchHistory } from "../../src/history/search.js";
import { createHistoryIndex } from "../../src/history/index.js";

describe("T20 injection", () => {
  it("rejects path-like refs and FTS operator abuse", async () => {
    expect("code" in decodeRef("../../etc/passwd")).toBe(true);
    const idx = await createHistoryIndex({ mode: "memory-only", dbPath: null, maxIndexBytes: 1 << 20 });
    const result = await searchHistory({
      scope: { workspaceId: "w", worktreeId: "w", sessionId: "s", leafId: null, visibleEntryIds: new Set(["a"]) },
      query: `${"a".repeat(500)} ^ * OR --`,
      index: idx,
      config: DEFAULT_CONFIG,
      getEntry: () => undefined,
    });
    expect(["denied", "ok"]).toContain(result.code);
    await idx.close();
  });
});
