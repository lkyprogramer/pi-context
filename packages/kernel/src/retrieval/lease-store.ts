import type { StoredRetrievalLease } from "../../../storage/src/protocol.js";
import { LeasePolicy, leaseAuthorityCeiling, type LeaseDependencyState, type RetrievalLease } from "./lease-policy.js";

export class LeaseStore {
  private readonly leases = new Map<string, RetrievalLease>();

  constructor(private readonly policy: LeasePolicy) {}

  create(input: Omit<RetrievalLease, "authority"> & { authority?: RetrievalLease["authority"] }): RetrievalLease {
    const existing = [...this.leases.values()].find((item) => item.pageId === input.pageId && item.sessionId === input.sessionId);
    if (existing) return existing;
    const lease: RetrievalLease = { ...input, authority: leaseAuthorityCeiling() };
    this.leases.set(lease.leaseId, lease);
    return lease;
  }

  renew(leaseId: string, tokens: number): RetrievalLease {
    const current = this.require(leaseId);
    const next = { ...current, turns: current.turns + 1, tokenTurns: current.tokenTurns + tokens };
    this.leases.set(leaseId, next);
    return next;
  }

  release(leaseId: string, reason: string): StoredRetrievalLease {
    const current = this.require(leaseId);
    this.leases.delete(leaseId);
    return { ...current, omittedReason: reason };
  }

  decide(leaseId: string, state: LeaseDependencyState) {
    return this.policy.next(this.require(leaseId), state);
  }

  active(): RetrievalLease[] {
    return [...this.leases.values()];
  }

  private require(leaseId: string): RetrievalLease {
    const lease = this.leases.get(leaseId);
    if (!lease) throw Object.assign(new Error("PCR_LEASE_NOT_FOUND"), { code: "PCR_LEASE_NOT_FOUND" });
    return lease;
  }
}
