import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config.js";
import { utf8Bytes } from "../../src/contracts.js";
import { encodeRef, textSourceHash } from "../../src/history/refs.js";
import { readHistory, reassemblePages } from "../../src/history/read.js";
import { imageTurn, independentBranch } from "../../src/testing.js";

describe("T09 history read", () => {
  it("reassembles exact utf-8 pages", () => {
    const fx = independentBranch();
    const entry = fx.entries.find((e) => e.id === "b")!;
    const text = "keep-http-paths";
    const ref = encodeRef({
      version: 5,
      workspaceId: "w",
      sessionId: fx.sessionId,
      entryId: "b",
      field: { kind: "text", blockIndex: 0 },
      sourceHash: textSourceHash(text),
    });
    const pages = [];
    let cursor: string | null = null;
    for (let i = 0; i < 8; i += 1) {
      const page = readHistory({
        scope: { workspaceId: "w", worktreeId: "w", sessionId: fx.sessionId, visibleEntryIds: new Set(["b"]) },
        ref,
        cursor,
        maxTokens: 1,
        config: { ...DEFAULT_CONFIG, history: { ...DEFAULT_CONFIG.history, readMaxBytes: 4 } },
        getEntry: (id) => fx.entries.find((e) => e.id === id),
      });
      if (page.page) pages.push(page.page);
      cursor = page.cursor;
      if (!cursor) break;
    }
    expect(reassemblePages(pages)).toBe(text);
    expect(utf8Bytes(reassemblePages(pages)).equals(utf8Bytes(text))).toBe(true);
  });

  it("returns native image blocks and denies cross-scope refs", () => {
    const img = imageTurn();
    const ref = encodeRef({
      version: 5,
      workspaceId: "other",
      sessionId: "nope",
      entryId: "u1",
      field: { kind: "image", blockIndex: 0 },
      sourceHash: "a".repeat(64),
    });
    const denied = readHistory({
      scope: { workspaceId: "w", worktreeId: "w", sessionId: "sess-img", visibleEntryIds: new Set(["u1"]) },
      ref,
      config: DEFAULT_CONFIG,
      getEntry: (id) => img.entries.find((e) => e.id === id),
    });
    expect(denied.code).toBe("denied");
  });
});
