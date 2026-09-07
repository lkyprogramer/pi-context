import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "@pcr/core";
import {
  createSemanticProposer,
  createSemanticProvider,
  type SemanticProposal,
} from "@pcr/runtime";

const WORK = mkdtempSync(join(tmpdir(), "pcr-work-"));

function cursor(leafId = "leaf-t35") {
  return createRuntimeCursor({
    workspacePath: WORK,
    sessionId: "session-t35",
    leafId,
    lineageEntryIds: ["root", leafId],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

function catalog(refs: string[]) {
  return {
    async pointers() {
      return refs.map((ref) => ({ ref, kind: "evidence" as const }));
    },
  };
}

function providerFor(bound: ReturnType<typeof cursor>) {
  return createSemanticProvider({
    cursor: bound,
    async generate(request) {
      const sourceRefs = request.sourceRefs.slice(0, 1);
      return {
        claims: sourceRefs.map((ref) => ({
          claimId: "cl_t35_version",
          key: "version",
          polarity: "is",
          status: "active",
          value: "7",
          sourceRefs: [ref],
        })),
        continuityPatch: { revisionId: "cr_t35", action: "keep" },
      };
    },
  });
}

async function runT35Fixture() {
  const bound = cursor();
  const proposer = createSemanticProposer({
    cursor: bound,
    evidence: catalog(["ev_t35", "ev_t35_tool"]),
    provider: providerFor(bound),
  });
  const input = { operationId: "op_t35", cursor: bound };
  const first = await proposer.propose(input, new AbortController().signal);
  const proposal: SemanticProposal = first;
  expect(proposal.proposalId).toMatch(/^[a-f0-9]{64}$/u);
  expect(proposal.sourceRefs).toEqual(["ev_t35"]);
  expect(proposal.claims).toHaveLength(1);
  expect(proposal.claims[0]?.sourceRefs).toEqual(["ev_t35"]);
  expect(proposal.claims[0]?.sourceRefs).not.toContain("ev_invented");
  const second = await proposer.propose(input, new AbortController().signal);
  expect(second).toEqual(first);
  return { ok: true as const, task: "T35" as const, proposal };
}

describe("T35 Evidence-cited semantic proposer", () => {
  it("evidence_cited_semantic_proposer", async () => {
    await expect(runT35Fixture()).resolves.toMatchObject({ ok: true, task: "T35" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createSemanticProposer({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_PROPOSER_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed input and empty evidence catalogs", async () => {
    const bound = cursor();
    const proposer = createSemanticProposer({
      cursor: bound,
      evidence: catalog(["ev_t35"]),
      provider: providerFor(bound),
    });
    await expect(proposer.propose({} as never, new AbortController().signal)).rejects.toMatchObject({
      code: "PCR_PROPOSER_INPUT_INVALID",
    });
    const empty = createSemanticProposer({
      cursor: bound,
      evidence: catalog([]),
      provider: providerFor(bound),
    });
    await expect(empty.propose({ operationId: "op_t35", cursor: bound }, new AbortController().signal)).rejects.toMatchObject({
      code: "PCR_PROPOSER_INPUT_INVALID",
    });
  });

  it("replays equal proposals for the same evidence catalog", async () => {
    const bound = cursor();
    const proposer = createSemanticProposer({
      cursor: bound,
      evidence: catalog(["ev_t35"]),
      provider: providerFor(bound),
    });
    const input = { operationId: "op_t35", cursor: bound };
    const first = await proposer.propose(input, new AbortController().signal);
    const second = await proposer.propose(input, new AbortController().signal);
    expect(second).toEqual(first);
    expect(first.claims[0]?.sourceRefs).toEqual(["ev_t35"]);
  });

  it("rejects a cursor from another workspace", async () => {
    const bound = cursor();
    const proposer = createSemanticProposer({
      cursor: bound,
      evidence: catalog(["ev_t35"]),
      provider: providerFor(bound),
    });
    const other = createRuntimeCursor({
      workspacePath: `${WORK}-other`,
      sessionId: "session-t35",
      leafId: "leaf-t35",
      lineageEntryIds: ["root", "leaf-t35"],
      modelKey: bound.modelKey,
    });
    await expect(proposer.propose({
      operationId: "op_t35",
      cursor: other,
    }, new AbortController().signal)).rejects.toMatchObject({
      code: "PCR_PROPOSER_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before reading evidence", async () => {
    const bound = cursor();
    let listed = 0;
    const proposer = createSemanticProposer({
      cursor: bound,
      evidence: {
        async pointers() {
          listed += 1;
          throw new Error("should not list evidence");
        },
      },
      provider: providerFor(bound),
    });
    await expect(proposer.propose(
      { operationId: "op_t35", cursor: bound },
      AbortSignal.abort(),
    )).rejects.toThrow();
    expect(listed).toBe(0);
  });
});
