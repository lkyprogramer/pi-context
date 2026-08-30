import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import {
  createCheckpointRenderer,
  createCheckpointVerifier,
  type CompactionSnapshot,
} from "../../src/compaction/checkpoint.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-core-checkpoint",
    sessionId: "session-checkpoint",
    leafId: "leaf-checkpoint",
    lineageEntryIds: ["root", "leaf-checkpoint"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function snapshot(bound = cursor()): CompactionSnapshot {
  return {
    snapshotHash: "a".repeat(64),
    cursor: bound,
    assembledAt: 1,
    reason: "manual",
    directives: [],
    continuity: {
      revisionId: "cr_x",
      parentRevisionId: null,
      contentHash: "c".repeat(64),
      cursor: bound,
      taskFronts: { active: [], parked: [], completed: [], superseded: [] },
      nextSafeActions: [],
    },
    claims: [],
    pointers: [],
    heads: {
      contextHead: "1".repeat(64),
      directiveHead: "2".repeat(64),
      claimHead: "3".repeat(64),
      continuityHead: "4".repeat(64),
      catalogHead: "5".repeat(64),
    },
  };
}

describe("checkpoint renderer and verifier", () => {
  it("preserves snapshot records and rejects polarity rewriting", async () => {
    const bound = cursor();
    const source = snapshot(bound);
    const renderer = createCheckpointRenderer({ cursor: bound });
    const verifier = createCheckpointVerifier({
      cursor: bound,
      pointers: { async verify() {} },
    });
    const candidate = await renderer.render(source);
    const ok = await verifier.verify(source, candidate);
    expect(ok.ok).toBe(true);
    const rewritten = await verifier.verify(source, {
      ...candidate,
      directives: [{
        directiveId: "d1",
        userTurnId: "u1",
        exactQuote: "keep going",
        quoteHash: "q".repeat(64),
        utf8ByteRange: { start: 0, end: 1 },
        utf16Range: { start: 0, end: 1 },
        codePointRange: { start: 0, end: 1 },
        kind: "goal",
        polarity: "must-not",
        status: "active",
      }],
    });
    expect(rewritten.ok).toBe(true);
    const withDirective: CompactionSnapshot = {
      ...source,
      directives: [{
        directiveId: "d1",
        userTurnId: "u1",
        exactQuote: "keep going",
        quoteHash: "q".repeat(64),
        utf8ByteRange: { start: 0, end: 1 },
        utf16Range: { start: 0, end: 1 },
        codePointRange: { start: 0, end: 1 },
        kind: "goal",
        polarity: "must",
        status: "active",
      }],
    };
    const rendered = await renderer.render(withDirective);
    expect(rendered.directives[0]?.polarity).toBe("must");
    const failed = await verifier.verify(withDirective, {
      ...rendered,
      directives: rendered.directives.map((item) => ({ ...item, polarity: "must-not" })),
    });
    expect(failed.ok).toBe(false);
    expect(failed.issues.some((item) => item.code === "PCR_CHECKPOINT_DIRECTIVE_REWRITTEN")).toBe(true);
  });

  it("fails construction without pointer verification", () => {
    expect(() => createCheckpointVerifier({ cursor: cursor() } as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CHECKPOINT_DEPENDENCY_MISSING" }),
    );
  });
});
