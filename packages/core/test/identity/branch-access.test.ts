import { describe, expect, it } from "vitest";

import {
  attachForkInheritance,
  BranchAccessError,
  buildBranchView,
  canReadSource,
  parseSourceCallId,
  parseSourceEntryId,
  sessionIdentityKey,
  sourceCallRef,
  sourceEntryRef,
} from "../../src/identity/branch-access.js";

describe("branch access", () => {
  it("reads ancestors but not sibling-only evidence", () => {
    const scope = { workspaceId: "w", sessionId: "s" };
    const entries = [
      { id: "r", parentId: null },
      { id: "a", parentId: "r" },
      { id: "b", parentId: "a" },
      { id: "sibling", parentId: "r" },
    ];
    const view = buildBranchView(scope, entries, "b");
    expect(canReadSource(view, { ...scope, entryId: "a" })).toBe(true);
    expect(canReadSource(view, { ...scope, entryId: "sibling" })).toBe(false);
    expect(canReadSource(view, { ...scope, sessionId: "other", entryId: "a" })).toBe(false);
  });

  it("rejects cycles and missing parents", () => {
    expect(() =>
      buildBranchView(
        { workspaceId: "w", sessionId: "s" },
        [
          { id: "a", parentId: "b" },
          { id: "b", parentId: "a" },
        ],
        "a",
      ),
    ).toThrowError(expect.objectContaining({ code: "PCR_BRANCH_CYCLE" }));
    expect(() =>
      buildBranchView(
        { workspaceId: "w", sessionId: "s" },
        [{ id: "child", parentId: "missing" }],
        "child",
      ),
    ).toThrowError(expect.objectContaining({ code: "PCR_BRANCH_MISSING_PARENT" }));
  });

  it("rejects duplicate ids and unknown heads", () => {
    expect(() =>
      buildBranchView(
        { workspaceId: "w", sessionId: "s" },
        [
          { id: "a", parentId: null },
          { id: "a", parentId: "a" },
        ],
        "a",
      ),
    ).toThrowError(expect.objectContaining({ code: "PCR_BRANCH_DUPLICATE_ID" }));
    expect(() =>
      buildBranchView(
        { workspaceId: "w", sessionId: "s" },
        [{ id: "a", parentId: null }],
        "missing",
      ),
    ).toThrowError(expect.objectContaining({ code: "PCR_BRANCH_HEAD_UNKNOWN" }));
  });

  it("allows a shared ancestor from two heads and keeps the session header as an explicit root", () => {
    const scope = { workspaceId: "w", sessionId: "s" };
    const entries = [
      { id: "header", parentId: null },
      { id: "a", parentId: "header" },
      { id: "left", parentId: "a" },
      { id: "right", parentId: "a" },
    ];
    const left = buildBranchView(scope, entries, "left");
    const right = buildBranchView(scope, entries, "right");
    expect(canReadSource(left, { ...scope, entryId: "a" })).toBe(true);
    expect(canReadSource(right, { ...scope, entryId: "a" })).toBe(true);
    expect(canReadSource(left, { ...scope, entryId: "right" })).toBe(false);
    expect(canReadSource(right, { ...scope, entryId: "left" })).toBe(false);
    expect(canReadSource(left, { ...scope, entryId: "header" })).toBe(true);
  });

  it("rejects a forged SourceLocation that is not ledger-bound to the current ancestors", () => {
    const view = buildBranchView(
      { workspaceId: "w", sessionId: "s" },
      [
        { id: "r", parentId: null },
        { id: "a", parentId: "r" },
      ],
      "a",
    );
    expect(canReadSource(view, { workspaceId: "w", sessionId: "s", entryId: "invented" })).toBe(false);
    expect(canReadSource(view, { workspaceId: "other", sessionId: "s", entryId: "a" })).toBe(false);
  });

  it("allows a host-proven fork to inherit copied ancestors and rejects a pseudo-fork", () => {
    const child = buildBranchView(
      { workspaceId: "w", sessionId: "child" },
      [
        { id: "r", parentId: null },
        { id: "a", parentId: "r" },
        { id: "child-only", parentId: "a" },
      ],
      "child-only",
    );
    const inherited = attachForkInheritance(child, {
      parentSessionId: "parent",
      parentSessionPath: "/tmp/parent.jsonl",
      claimedParentSessionPath: "/tmp/parent.jsonl",
      parentEntryIds: new Set(["r", "a"]),
    });
    expect(canReadSource(inherited, { workspaceId: "w", sessionId: "parent", entryId: "a" })).toBe(true);
    expect(canReadSource(inherited, { workspaceId: "w", sessionId: "parent", entryId: "child-only" })).toBe(false);
    expect(canReadSource(child, { workspaceId: "w", sessionId: "parent", entryId: "a" })).toBe(false);
    expect(() =>
      attachForkInheritance(child, {
        parentSessionId: "parent",
        parentSessionPath: "/tmp/parent.jsonl",
        claimedParentSessionPath: "/tmp/forged.jsonl",
        parentEntryIds: new Set(["a"]),
      }),
    ).toThrowError(BranchAccessError);
    expect(sessionIdentityKey({ workspaceId: "w", sessionId: "s" })).toBe(JSON.stringify(["w", "s"]));
  });

  it("parses ledger refs without treating a model-supplied ancestor id as a source binding", () => {
    expect(parseSourceEntryId([sourceEntryRef("host-1"), "model:a"])).toBe("host-1");
    expect(parseSourceCallId([sourceCallRef("call-1")])).toBe("call-1");
    expect(parseSourceEntryId(["call-1", "blob_abc"])).toBeUndefined();
  });
});
