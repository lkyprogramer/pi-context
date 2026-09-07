import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { authorizeHits, buildScope, normalizeWorkspace } from "../../src/history/scope.js";
import { independentBranch } from "../../src/testing.js";

describe("T06 scope", () => {
  it("F03 returns b not sibling", () => {
    const fx = independentBranch();
    const scope = {
      workspaceId: "w",
      worktreeId: "w",
      sessionId: fx.sessionId,
      visibleEntryIds: new Set(["a", "b"]),
    };
    const hits = authorizeHits(scope, [
      { entryId: "sibling", score: 99 },
      { entryId: "b", score: 1 },
    ], 1);
    expect(hits.map((h) => h.entryId)).toEqual(["b"]);
  });

  it("fork copies entry id across sessions without sharing authorization", () => {
    const a = { workspaceId: "w", worktreeId: "w", sessionId: "s1", visibleEntryIds: new Set(["e1"]) };
    const b = { workspaceId: "w", worktreeId: "w", sessionId: "s2", visibleEntryIds: new Set(["e1-fork"]) };
    expect(authorizeHits(a, [{ entryId: "e1-fork", score: 100 }], 1)).toEqual([]);
    expect(authorizeHits(b, [{ entryId: "e1", score: 100 }], 1)).toEqual([]);
  });

  it("HOME cwd does not persist a project index", () => {
    expect(normalizeWorkspace(homedir()).persist).toBe(false);
    const fx = independentBranch();
    const scope = buildScope({
      cwd: process.cwd(),
      sessionId: fx.sessionId,
      leafId: "b",
      getEntry: (id) => fx.entries.find((e) => e.id === id),
    });
    expect(scope.visibleEntryIds.has("sibling")).toBe(false);
  });
});
