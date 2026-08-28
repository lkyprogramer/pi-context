import { describe, expect, it } from "vitest";
import type { LeaseDependencyState, RetrievalLease } from "../src/retrieval/lease-policy.js";
import { LeasePolicy, leaseAuthorityCeiling } from "../src/retrieval/lease-policy.js";
import { LeaseStore } from "../src/retrieval/lease-store.js";

function activeLease(partial: Partial<RetrievalLease> = {}): RetrievalLease {
  return {
    leaseId: "ls_1",
    pageId: "pg_1",
    purpose: "recall",
    sessionId: "s1",
    branchScope: "main",
    authority: "inform",
    turns: 1,
    tokenTurns: 100,
    expiresAt: 10_000,
    ...partial,
  };
}

function unresolvedDependency(): LeaseDependencyState {
  return { taskStatus: "active", unresolvedDependents: 1, evidenceSuperseded: false };
}

function completedFront(): LeaseDependencyState {
  return { taskStatus: "completed", unresolvedDependents: 0, evidenceSuperseded: false };
}

describe("lease policy", () => {
  it("renews only while an unresolved action still depends on the evidence", () => {
    const policy = new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000 });
    expect(policy.next(activeLease(), unresolvedDependency())).toMatchObject({ action: "renew" });
    expect(policy.next(activeLease(), completedFront())).toMatchObject({ action: "release", reason: "task-completed" });
  });

  it("lets absolute expiry win over dependents", () => {
    const policy = new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000, now: 20_000 });
    expect(policy.next(activeLease({ expiresAt: 10_000 }), unresolvedDependency())).toMatchObject({
      action: "release",
      reason: "expired",
    });
  });

  it("releases on branch or session mismatch", () => {
    const policy = new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000 });
    expect(
      policy.next(activeLease(), { ...unresolvedDependency(), sessionId: "other" }),
    ).toMatchObject({ action: "release", reason: "scope-mismatch" });
    expect(
      policy.next(activeLease(), { ...unresolvedDependency(), branchScope: "fork" }),
    ).toMatchObject({ action: "release", reason: "scope-mismatch" });
  });

  it("dedupes the same page lease", () => {
    const store = new LeaseStore(new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000 }));
    const first = store.create(activeLease({ leaseId: "ls_a", pageId: "pg_same" }));
    const second = store.create(activeLease({ leaseId: "ls_b", pageId: "pg_same" }));
    expect(second.leaseId).toBe(first.leaseId);
    expect(store.active()).toHaveLength(1);
  });

  it("never promotes a retrieval lease to directive or act authority", () => {
    const store = new LeaseStore(new LeasePolicy({ maxTurns: 4, maxTokenTurns: 6000 }));
    const lease = store.create(activeLease({ authority: "act" }));
    expect(lease.authority).toBe("inform");
    expect(leaseAuthorityCeiling()).toBe("inform");
    expect(lease.authority).not.toBe("act");
  });
});
