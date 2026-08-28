import { describe, expect, it } from "vitest";
import type { ContinuityRevision } from "../../contracts/src/types.js";
import { reduceContinuityRevision } from "../src/continuity/reducer.js";

function activeDeploymentFront(): ContinuityRevision {
  return {
    revisionId: "cr_aaaaaaaa",
    parentRevisionId: null,
    cursor: {
      workspaceId: "ws_0123456789abcdef",
      sessionId: "s1",
      leafId: "leaf1",
      lineageHash: "1111111111111111111111111111111111111111111111111111111111111111",
      modelKey: "test",
      thinkingLevel: "off",
    },
    taskFronts: {
      active: [
        {
          id: "tf_aaaaaaaa",
          title: "deploy service",
          status: "active",
          goalClaimId: "cl_aaaaaaaa",
          evidenceIds: ["ev_aaaaaaaa"],
        },
      ],
      parked: [],
      completed: [],
      superseded: [],
    },
    constraints: [],
    decisions: [],
    unresolvedErrors: [],
    externalSideEffects: [{ id: "se_deploy", kind: "deploy", status: "running-unverified" }],
    validationState: [],
    changedArtifacts: [],
    delegations: [],
    nextSafeActions: [{ text: "watch deploy", requires: ["ev_aaaaaaaa"] }],
  };
}

describe("continuity", () => {
  it("parks an old front without pretending its external process rolled back", () => {
    const next = reduceContinuityRevision(activeDeploymentFront(), { type: "user-goal-change", newGoal: "fix parser" });
    expect(next.taskFronts.parked).toHaveLength(1);
    expect(next.externalSideEffects[0]?.status).toBe("running-unverified");
    expect(next.parentRevisionId).toBe("cr_aaaaaaaa");
    expect(next.revisionId).not.toBe("cr_aaaaaaaa");
  });

  it("does not reactivate a completed front without new user evidence", () => {
    const completed = reduceContinuityRevision(activeDeploymentFront(), {
      type: "complete-front",
      frontId: "tf_aaaaaaaa",
      evidenceId: "ev_bbbbbbbb",
    });
    expect(completed.taskFronts.completed).toHaveLength(1);
    const denied = reduceContinuityRevision(completed, { type: "reactivate-front", frontId: "tf_aaaaaaaa" });
    expect(denied.taskFronts.completed).toHaveLength(1);
    expect(denied.taskFronts.active).toHaveLength(0);
    const allowed = reduceContinuityRevision(completed, {
      type: "reactivate-front",
      frontId: "tf_aaaaaaaa",
      evidenceId: "ev_cccccccc",
      sourceClass: "authenticated-user",
    });
    expect(allowed.taskFronts.active.map((item) => item.id)).toEqual(["tf_aaaaaaaa"]);
  });

  it("keeps an unresolved error when only the target wording changes", () => {
    const withError = reduceContinuityRevision(activeDeploymentFront(), {
      type: "error-observed",
      error: { id: "err_1", stage: "observed", message: "boom" },
    });
    const reworded = reduceContinuityRevision(withError, { type: "reword-target", text: "please fix the parser nicely" });
    expect(reworded.unresolvedErrors).toEqual([{ id: "err_1", stage: "observed", message: "boom" }]);
  });

  it("requires tool evidence before a side-effect can be marked verified", () => {
    expect(() =>
      reduceContinuityRevision(activeDeploymentFront(), {
        type: "side-effect-update",
        id: "se_deploy",
        status: "verified",
      }),
    ).toThrow(/PCR_SIDE_EFFECT_EVIDENCE_MISSING/);
    const verified = reduceContinuityRevision(activeDeploymentFront(), {
      type: "side-effect-update",
      id: "se_deploy",
      status: "verified",
      toolEvidenceId: "ev_tool_ok",
    });
    expect(verified.externalSideEffects[0]).toMatchObject({ status: "verified", toolEvidenceId: "ev_tool_ok" });
  });

  it("fails closed on ledger overflow", () => {
    expect(() => reduceContinuityRevision(activeDeploymentFront(), { type: "overflow" })).toThrow(/PCR_CONTINUITY_OVERFLOW/);
  });
});
