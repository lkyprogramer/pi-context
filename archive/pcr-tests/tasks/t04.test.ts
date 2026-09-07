import { describe, expect, it } from "vitest";

import {
  createRuntimeCursor,
  stableDirectiveId,
  stableEvidenceId,
  stableHostMessageId,
} from "../../packages/core/src/identity/stable-identity.js";

const HASH = "a".repeat(64);

function runT04Fixture() {
  const cursor = createRuntimeCursor({
    workspacePath: "/workspace/project",
    sessionId: "session-1",
    leafId: "entry-9",
    lineageEntryIds: ["entry-1", "entry-9"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const identityInput = { cursor, sourceEntryId: "entry-9", contentHash: HASH, toolCallId: "tool-3" };
  const identities = {
    host: stableHostMessageId(identityInput),
    evidence: stableEvidenceId(identityInput),
    directive: stableDirectiveId(identityInput),
  };
  return { cursor, identities, ok: new Set(Object.values(identities)).size === 3, task: "T04" as const };
}

describe("T04 Stable cursor and identity primitives", () => {
  it("stable_cursor_and_identity_primitives", () => {
    const result = runT04Fixture();

    expect(result).toMatchObject({ ok: true, task: "T04" });
    expect(result.cursor).toEqual({
      workspaceId: expect.stringMatching(/^ws_[0-9a-f]{40}$/u),
      sessionId: "session-1",
      leafId: "entry-9",
      lineageHash: expect.stringMatching(/^[0-9a-f]{64}$/u),
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    expect(result.identities.host).toMatch(/^host_[0-9a-f]{64}$/u);
    expect(result.identities.evidence).toMatch(/^evidence_[0-9a-f]{64}$/u);
    expect(result.identities.directive).toMatch(/^directive_[0-9a-f]{64}$/u);
  });

  it("is stable across deterministic replay", () => {
    expect(runT04Fixture()).toEqual(runT04Fixture());
  });

  it("changes identity across workspace, session, branch leaf, and source entry scopes", () => {
    const baseline = runT04Fixture();
    const variants = [
      { workspacePath: "/workspace/other", sessionId: "session-1", leafId: "entry-9" },
      { workspacePath: "/workspace/project", sessionId: "session-2", leafId: "entry-9" },
      { workspacePath: "/workspace/project", sessionId: "session-1", leafId: "entry-10" },
    ].map((input) => {
      const cursor = createRuntimeCursor({
        ...input,
        lineageEntryIds: ["entry-1", input.leafId],
        modelKey: "openclaw/Qwen3.8-27B-WORK",
      });
      return stableHostMessageId({ cursor, sourceEntryId: input.leafId, contentHash: HASH });
    });
    variants.push(
      stableHostMessageId({ cursor: baseline.cursor, sourceEntryId: "entry-10", contentHash: HASH }),
    );

    expect(new Set([baseline.identities.host, ...variants]).size).toBe(variants.length + 1);
  });

  it("changes lineage identity when entry order changes", () => {
    const forward = createRuntimeCursor({
      workspacePath: "/workspace/project",
      sessionId: "session-1",
      leafId: "entry-2",
      lineageEntryIds: ["entry-1", "entry-2"],
      modelKey: "model",
    });
    const reversed = createRuntimeCursor({
      workspacePath: "/workspace/project",
      sessionId: "session-1",
      leafId: "entry-2",
      lineageEntryIds: ["entry-2", "entry-1"],
      modelKey: "model",
    });

    expect(reversed.lineageHash).not.toBe(forward.lineageHash);
  });

  it("normalizes harmless workspace separators without merging distinct paths", () => {
    const base = {
      sessionId: "session-1",
      leafId: null,
      lineageEntryIds: ["root"],
      modelKey: "model",
    };
    const normalized = createRuntimeCursor({ ...base, workspacePath: "/workspace/project/" });
    const repeated = createRuntimeCursor({ ...base, workspacePath: "/workspace//project" });
    const distinct = createRuntimeCursor({ ...base, workspacePath: "/workspace/Project" });

    expect(repeated.workspaceId).toBe(normalized.workspaceId);
    expect(distinct.workspaceId).not.toBe(normalized.workspaceId);
  });

  it("rejects malformed scope and content inputs", () => {
    expect(() =>
      createRuntimeCursor({
        workspacePath: "",
        sessionId: "session-1",
        leafId: null,
        lineageEntryIds: [],
        modelKey: "model",
      }),
    ).toThrow("workspacePath");
    expect(() =>
      stableEvidenceId({ cursor: runT04Fixture().cursor, sourceEntryId: "entry", contentHash: "bad" }),
    ).toThrow("contentHash");
  });

  it("rejects array-index identity inputs instead of silently accepting unstable provenance", () => {
    const result = runT04Fixture();

    expect(() =>
      stableHostMessageId({
        cursor: result.cursor,
        sourceEntryId: "entry-9",
        contentHash: HASH,
        index: 9,
      } as never),
    ).toThrow("unknown identity field: index");
  });
});
