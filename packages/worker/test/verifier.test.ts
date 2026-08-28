import { describe, expect, it } from "vitest";
import type { SemanticProposal } from "../src/semantic/proposal.js";
import {
  applyDeterministicRepairs,
  collectGaps,
  deterministicFloor,
  verifySemanticProposal,
  type VerificationState,
} from "../src/verifier/verifier.js";

function proposalSaysTestsPassed(): SemanticProposal {
  return {
    taskFrontUpdates: [],
    claimSelections: [{ claimId: "cl_tests", role: "outcome" }],
    narrative: [{ text: "tests passed", sourceIds: ["ev_test"], epistemic: "supported" }],
  };
}

function fixtureStateWithFailedTest(): VerificationState {
  return {
    sourceHead: "src-1",
    knownClaimIds: ["cl_tests"],
    knownFrontIds: [],
    knownSourceIds: ["ev_test"],
    claims: [{ claimId: "cl_tests", role: "outcome", authority: "propose" }],
    evidence: [{ id: "ev_test", kind: "test", ok: false, text: "FAIL case-1", sourceClass: "trusted-tool" }],
  };
}

function passingProposal(): SemanticProposal {
  return {
    taskFrontUpdates: [{ frontId: "tf_a", action: "keep", sourceIds: ["ev_ok"] }],
    claimSelections: [{ claimId: "cl_a", role: "decision" }],
    narrative: [{ text: "keep the current decision", sourceIds: ["ev_ok"], epistemic: "supported" }],
  };
}

function passingState(partial: Partial<VerificationState> = {}): VerificationState {
  return {
    sourceHead: "src-1",
    knownClaimIds: ["cl_a", "cl_conflict"],
    knownFrontIds: ["tf_a"],
    knownSourceIds: ["ev_ok", "dir_hard"],
    claims: [{ claimId: "cl_a", role: "decision", authority: "propose", polarity: "is" }],
    evidence: [{ id: "ev_ok", kind: "note", ok: true, text: "keep the current decision", sourceClass: "authenticated-user" }],
    tokensBefore: 200,
    tokensAfter: 120,
    hardDirectives: [{ id: "dir_hard", covered: true }],
    now: 10,
    ...partial,
  };
}

describe("proposal verifier", () => {
  it("rejects an assistant-authored success claim contradicted by failed tool evidence", async () => {
    const report = await verifySemanticProposal(proposalSaysTestsPassed(), fixtureStateWithFailedTest());
    expect(report.ok).toBe(false);
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "UNSUPPORTED_OUTCOME" }));
    expect(report.usedFloor).toBe(true);
    expect(report.floor.kind).toBe("deterministic-floor");
  });

  it("accepts a shrinking source-linked proposal", async () => {
    const report = await verifySemanticProposal(passingProposal(), passingState());
    expect(report).toMatchObject({ ok: true, gaps: [], repaired: false, usedFloor: false });
  });

  it("rejects a host compaction that does not must-shrink", async () => {
    const report = await verifySemanticProposal(passingProposal(), passingState({ tokensAfter: 200 }));
    expect(report.ok).toBe(false);
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "MUST_SHRINK" }));
  });

  it("requires 100% hard directive coverage", async () => {
    const report = await verifySemanticProposal(
      passingProposal(),
      passingState({ hardDirectives: [{ id: "dir_hard", covered: false }] }),
    );
    expect(report.ok).toBe(false);
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "HARD_DIRECTIVE_UNCOVERED" }));
  });

  it("retains contested conflicts instead of dropping them", async () => {
    const report = await verifySemanticProposal(
      passingProposal(),
      passingState({
        claims: [
          { claimId: "cl_a", role: "decision", authority: "propose" },
          { claimId: "cl_conflict", status: "contested", conflictsWith: ["cl_a"] },
        ],
      }),
    );
    expect(report.ok).toBe(false);
    expect(report.gaps).toContainEqual(expect.objectContaining({ code: "CONFLICT_DROPPED" }));
  });

  it("forbids new concrete entities without evidence", async () => {
    const proposal: SemanticProposal = {
      ...passingProposal(),
      narrative: [{ text: "edit src/secret.ts", sourceIds: ["ev_ok"], epistemic: "inference" }],
    };
    expect(collectGaps(proposal, passingState())).toContainEqual(expect.objectContaining({ code: "NEW_CONCRETE_ENTITY" }));
  });

  it("applies deterministic repairs idempotently and keeps a floor", async () => {
    const dirty: SemanticProposal = {
      ...passingProposal(),
      narrative: [
        { text: "keep the current decision", sourceIds: ["ev_ok"], epistemic: "supported" },
        { text: "also touch src/ghost.ts", sourceIds: ["ev_ok"], epistemic: "inference" },
        { text: "orphan", sourceIds: ["ev_missing"], epistemic: "inference" },
      ],
    };
    const state = passingState({ knownSourceIds: ["ev_ok", "dir_hard", "ev_missing"] });
    const gaps = collectGaps(dirty, state);
    const once = applyDeterministicRepairs(dirty, gaps, state);
    const twice = applyDeterministicRepairs(once.proposal, collectGaps(once.proposal, state), state);
    expect(once.repaired).toBe(true);
    expect(twice.proposal).toEqual(once.proposal);
    const report = await verifySemanticProposal(dirty, state);
    expect(report.ok).toBe(true);
    expect(report.repaired).toBe(true);
    expect(deterministicFloor(passingState()).claimIds).toEqual(["cl_a", "cl_conflict"]);
  });

  it("fails if any deterministic guard is removed", async () => {
    const mutations: Array<{ name: string; proposal: SemanticProposal; state: VerificationState; code: string }> = [
      { name: "schema", proposal: { ...passingProposal(), claimSelections: [{ claimId: "cl_new", role: "context" }] }, state: passingState(), code: "SCHEMA_OR_ID" },
      { name: "support", proposal: { ...passingProposal(), narrative: [{ text: "keep", sourceIds: ["ev_missing"], epistemic: "supported" }] }, state: passingState({ knownSourceIds: ["ev_ok", "dir_hard", "ev_missing"] }), code: "SUPPORT_MISSING" },
      { name: "polarity", proposal: { ...passingProposal(), claimSelections: [{ claimId: "cl_a", role: "outcome" }] }, state: passingState({ claims: [{ claimId: "cl_a", polarity: "must-not", authority: "propose" }] }), code: "POLARITY_OR_TIME" },
      { name: "authority", proposal: proposalSaysTestsPassed(), state: { ...fixtureStateWithFailedTest(), evidence: [{ id: "ev_test", kind: "note", ok: true, sourceClass: "untrusted-tool" }] }, code: "AUTHORITY_ESCALATION" },
      { name: "outcome", proposal: proposalSaysTestsPassed(), state: fixtureStateWithFailedTest(), code: "UNSUPPORTED_OUTCOME" },
      { name: "directive", proposal: passingProposal(), state: passingState({ hardDirectives: [{ id: "dir_hard", covered: false }] }), code: "HARD_DIRECTIVE_UNCOVERED" },
      { name: "shrink", proposal: passingProposal(), state: passingState({ tokensAfter: 400 }), code: "MUST_SHRINK" },
      { name: "entity", proposal: { ...passingProposal(), narrative: [{ text: "src/x.ts", sourceIds: ["ev_ok"], epistemic: "inference" }] }, state: passingState(), code: "NEW_CONCRETE_ENTITY" },
      { name: "conflict", proposal: passingProposal(), state: passingState({ claims: [{ claimId: "cl_a", authority: "propose" }, { claimId: "cl_conflict", status: "contested" }] }), code: "CONFLICT_DROPPED" },
    ];
    for (const mutation of mutations) {
      expect(collectGaps(mutation.proposal, mutation.state), mutation.name).toContainEqual(
        expect.objectContaining({ code: mutation.code }),
      );
    }
  });
});
