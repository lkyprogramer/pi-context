import { describe, expect, it } from "vitest";
import type { HostCheckpoint } from "../../contracts/src/types.js";
import { buildDeterministicCheckpointCandidate, type HostCompactionPreparation, type RuntimeState } from "../src/compaction/candidate.js";

function fixtureCheckpoint(): HostCheckpoint {
  return {
    directives: [{ directiveId: "dir_keep", quote: "do not deploy prod", polarity: "must-not", status: "active" }],
    continuity: { revisionId: "cr_aaaaaaaa" },
    claims: [],
    pointers: [{ ref: "blob_ok", kind: "raw-blob" }],
    heads: {
      contextHead: "ctx_aaaaaaaa",
      directiveHead: "dh_1",
      claimHead: "ch_1",
      continuityHead: "cth_1",
      catalogHead: "cah_1",
    },
  };
}

function fixturePreparation(partial: Partial<HostCompactionPreparation> = {}): HostCompactionPreparation {
  return {
    tokensBefore: 500,
    firstKeptEntryId: "entry_tail",
    retainedTail: [],
    branchScope: "main",
    head: "leaf-a",
    directives: [{ directiveId: "dir_keep", quote: "do not deploy prod" }],
    reason: "threshold",
    ...partial,
  };
}

function fixtureState(partial: Partial<RuntimeState> = {}): RuntimeState {
  return {
    checkpoint: fixtureCheckpoint(),
    verifiedPointers: new Set(["blob_ok"]),
    branchScope: "main",
    head: "leaf-a",
    counter: {
      countText: (text) => Math.ceil(text.length / 4),
      countMessages: (messages) => messages.length * 10,
    },
    waitForSemantic: false,
    ...partial,
  };
}

describe("checkpoint candidate", () => {
  it("rejects a checkpoint that does not reduce the prepared host span", async () => {
    const result = await buildDeterministicCheckpointCandidate(fixturePreparation({ tokensBefore: 500 }), fixtureState({ renderedTokens: 600 }));
    expect(result).toMatchObject({ kind: "rejected", code: "PCR_HOST_COMPACTION_NOT_SHRINKING" });
  });

  it("rejects when the source branch or head does not match preparation", async () => {
    const result = await buildDeterministicCheckpointCandidate(
      fixturePreparation({ head: "leaf-a" }),
      fixtureState({ head: "leaf-b", renderedTokens: 100 }),
    );
    expect(result).toMatchObject({ kind: "rejected", code: "PCR_CHECKPOINT_SOURCE_MISMATCH" });
  });

  it("rejects unverified pointers", async () => {
    const result = await buildDeterministicCheckpointCandidate(
      fixturePreparation(),
      fixtureState({ verifiedPointers: new Set(), renderedTokens: 100 }),
    );
    expect(result).toMatchObject({ kind: "rejected", code: "PCR_CHECKPOINT_POINTER_UNVERIFIED" });
  });

  it("requires 100% hard directive coverage", async () => {
    const result = await buildDeterministicCheckpointCandidate(
      fixturePreparation({ directives: [{ directiveId: "dir_missing", quote: "keep secrets" }] }),
      fixtureState({ renderedTokens: 100 }),
    );
    expect(result).toMatchObject({ kind: "rejected", code: "PCR_CHECKPOINT_DIRECTIVE_COVERAGE" });
  });

  it("never waits for a semantic worker on overflow", async () => {
    const state = fixtureState({ renderedTokens: 80, waitForSemantic: true });
    const result = await buildDeterministicCheckpointCandidate(fixturePreparation({ reason: "overflow", tokensBefore: 500 }), state);
    expect(result.kind).toBe("ready");
    expect(state.waitForSemantic).toBe(false);
    if (result.kind === "ready") {
      expect(result.candidate.estimatedTokensAfter).toBeLessThan(result.candidate.tokensBefore);
      expect(result.candidate.firstKeptEntryId).toBe("entry_tail");
    }
  });
});
