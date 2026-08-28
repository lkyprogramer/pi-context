import { describe, expect, it } from "vitest";
import { applyTransitionToSlice, conflictSet, projectAudit, projectCurrent } from "../src/claims/resolve.js";
import type { Claim } from "../src/claims/model.js";
import { applyClaimTransition } from "../src/claims/transitions.js";

function claim(partial: Partial<Claim> & Pick<Claim, "claimId" | "authority" | "value" | "polarity">): Claim {
  return {
    key: "constraint/prod",
    claimType: "constraint",
    status: "active",
    validTime: { start: 1, end: null },
    systemTime: { start: 1, end: null },
    support: ["ev_user"],
    supersedes: [],
    conflictsWith: [],
    ...partial,
  };
}

function activeAuthenticatedConstraint(): Claim {
  return claim({
    claimId: "cl_original",
    authority: "act",
    value: "do-not-deploy-prod",
    polarity: "must-not",
  });
}

function agentDerivedReplacement(): Claim {
  return claim({
    claimId: "cl_agent",
    authority: "propose",
    value: "deploy-prod",
    polarity: "must",
    support: ["ev_agent"],
    systemTime: { start: 2, end: null },
  });
}

describe("claim transitions", () => {
  it("does not allow agent-derived text to supersede an authenticated prohibition", () => {
    const result = applyClaimTransition(activeAuthenticatedConstraint(), agentDerivedReplacement());
    expect(result.kind).toBe("contested");
    expect(result.current.claimId).toBe("cl_original");
  });

  it("does not make the last writer an automatic winner", () => {
    const current = claim({
      claimId: "cl_original",
      authority: "act",
      value: "keep-staging",
      polarity: "must",
    });
    const later = claim({
      claimId: "cl_later",
      authority: "act",
      value: "ship-prod",
      polarity: "must",
      systemTime: { start: 99, end: null },
    });
    const result = applyClaimTransition(current, later);
    expect(result.kind).toBe("contested");
    expect(result.current.claimId).toBe("cl_original");
  });

  it("treats negative polarity as a fact, not as absence", () => {
    const prohibition = activeAuthenticatedConstraint();
    expect(projectCurrent([prohibition])).toEqual([prohibition]);
    expect(prohibition.polarity).toBe("must-not");
    expect(projectCurrent([])).toEqual([]);
  });

  it("rejects retraction without original authority or fresh user authorization", () => {
    const current = activeAuthenticatedConstraint();
    const rejected = applyClaimTransition(current, {
      ...current,
      claimId: "cl_retract_inform",
      status: "retracted",
      authority: "inform",
      systemTime: { start: 8, end: null },
    });
    expect(rejected.kind).toBe("rejected");
    const allowed = applyClaimTransition(current, {
      ...current,
      claimId: "cl_retract_user",
      status: "retracted",
      authority: "act",
      systemTime: { start: 8, end: null },
    });
    expect(allowed.kind).toBe("retracted");
    expect(allowed.current.status).toBe("retracted");
  });

  it("excludes audit rows from the default active query", () => {
    const current = activeAuthenticatedConstraint();
    const next = claim({
      claimId: "cl_user_fix",
      authority: "act",
      value: "do-not-deploy-prod-except-canary",
      polarity: "must-not",
      supersedes: ["cl_original"],
      systemTime: { start: 5, end: null },
    });
    const result = applyClaimTransition(current, next);
    expect(result.kind).toBe("superseded");
    const slice = applyTransitionToSlice([current], current, result);
    expect(projectCurrent(slice).map((item) => item.claimId)).toEqual(["cl_user_fix"]);
    expect(projectAudit(slice).map((item) => item.claimId).sort()).toEqual(["cl_original", "cl_user_fix"]);
    expect(projectCurrent(slice).every((item) => item.status === "active")).toBe(true);
  });

  it("keeps both sides of a conflict set", () => {
    const current = activeAuthenticatedConstraint();
    const result = applyClaimTransition(current, agentDerivedReplacement());
    const slice = applyTransitionToSlice([current], current, result);
    const conflicts = conflictSet(slice);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.map((item) => item.claimId).sort()).toEqual(["cl_agent", "cl_original"]);
  });

  it("fails closed on an unknown transition strategy", () => {
    const result = applyClaimTransition(activeAuthenticatedConstraint(), {
      ...agentDerivedReplacement(),
      polarity: "unknown",
    });
    expect(result).toMatchObject({ kind: "rejected", reason: "unknown-strategy" });
  });
});
