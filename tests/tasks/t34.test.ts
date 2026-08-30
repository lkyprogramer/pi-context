import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import { createSemanticProvider, type SemanticProposal } from "@pcr/runtime";

const WORK = "/var/folders/yt/10k_hqkn30x18d7lbn28_gnc0000gn/T/grok-goal-14eb40de3fb3/implementer/t34";

function cursor(leafId = "leaf-t34") {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t34",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function rawProposal(sourceRefs = ["ev_t34"]) {
  return {
    claims: [{
      claimId: "cl_t34_version",
      key: "version",
      polarity: "is",
      status: "active",
      value: "7",
      sourceRefs,
    }],
    continuityPatch: { revisionId: "cr_t34", action: "keep" },
  };
}

async function runT34Fixture() {
  const bound = cursor();
  const sourceRefs = ["ev_t34", "ev_t34_tool"];
  const provider = createSemanticProvider({
    cursor: bound,
    async generate() {
      return rawProposal(["ev_t34"]);
    },
  });
  const request = {
    operationId: "op_t34",
    cursor: bound,
    sourceRefs,
  };
  const first = await provider.propose(request);
  const proposal: SemanticProposal = first;
  expect(proposal.proposalId).toMatch(/^[a-f0-9]{64}$/u);
  expect(proposal.sourceRefs).toEqual(["ev_t34"]);
  expect(proposal.claims).toEqual([expect.objectContaining({
    claimId: "cl_t34_version",
    key: "version",
    sourceRefs: ["ev_t34"],
  })]);
  expect(proposal.continuityPatch).toEqual({ revisionId: "cr_t34", action: "keep" });
  const second = await provider.propose(request);
  expect(second).toEqual(first);
  return { ok: true as const, task: "T34" as const, proposal };
}

describe("T34 Semantic proposal contracts and provider port", () => {
  it("semantic_proposal_contracts_and_provider_port", async () => {
    await expect(runT34Fixture()).resolves.toMatchObject({ ok: true, task: "T34" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createSemanticProvider({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_SEMANTIC_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed propose input and hidden reasoning", async () => {
    const bound = cursor();
    const provider = createSemanticProvider({
      cursor: bound,
      async generate() { return rawProposal(); },
    });
    await expect(provider.propose({} as never)).rejects.toMatchObject({ code: "PCR_SEMANTIC_INPUT_INVALID" });
    const hidden = createSemanticProvider({
      cursor: bound,
      async generate() { return { ...rawProposal(), hiddenReasoning: "secret" }; },
    });
    await expect(hidden.propose({
      operationId: "op_t34",
      cursor: bound,
      sourceRefs: ["ev_t34"],
    })).rejects.toMatchObject({ code: "PCR_SEMANTIC_INPUT_INVALID" });
    const missingValue = createSemanticProvider({
      cursor: bound,
      async generate() {
        return {
          claims: [{
            claimId: "cl_t34_version",
            key: "version",
            polarity: "is",
            status: "active",
            sourceRefs: ["ev_t34"],
          }],
        };
      },
    });
    await expect(missingValue.propose({
      operationId: "op_t34",
      cursor: bound,
      sourceRefs: ["ev_t34"],
    })).rejects.toMatchObject({ code: "PCR_SEMANTIC_INPUT_INVALID" });
  });

  it("replays equal proposals for the same generate output", async () => {
    const bound = cursor();
    const provider = createSemanticProvider({
      cursor: bound,
      async generate() { return rawProposal(); },
    });
    const input = { operationId: "op_t34", cursor: bound, sourceRefs: ["ev_t34"] };
    const first = await provider.propose(input);
    const second = await provider.propose(input);
    expect(second).toEqual(first);
    expect(first.proposalId).toBe(second.proposalId);
  });

  it("rejects a cursor from another workspace", async () => {
    const bound = cursor();
    const provider = createSemanticProvider({
      cursor: bound,
      async generate() { return rawProposal(); },
    });
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t34",
      leafId: "leaf-t34",
      lineageEntryIds: ["root", "leaf-t34"],
      modelKey: bound.modelKey,
    });
    await expect(provider.propose({
      operationId: "op_t34",
      cursor: other,
      sourceRefs: ["ev_t34"],
    })).rejects.toMatchObject({ code: "PCR_SEMANTIC_SCOPE_MISMATCH" });
  });

  it("stops at the abort boundary before generating", async () => {
    const bound = cursor();
    let generated = 0;
    const provider = createSemanticProvider({
      cursor: bound,
      async generate() {
        generated += 1;
        throw new Error("should not generate");
      },
    });
    await expect(provider.propose({
      operationId: "op_t34",
      cursor: bound,
      sourceRefs: ["ev_t34"],
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(generated).toBe(0);
  });
});
