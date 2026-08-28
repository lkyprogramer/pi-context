import type { ActionAuthority } from "../../../contracts/src/index.js";

export interface RetrievalLease {
  leaseId: string;
  pageId: string;
  purpose: string;
  sessionId: string;
  branchScope: string;
  authority: ActionAuthority;
  turns: number;
  tokenTurns: number;
  expiresAt: number;
}

export interface LeasePolicyConfig {
  maxTurns: number;
  maxTokenTurns: number;
  now?: number;
}

export interface LeaseDependencyState {
  taskStatus: "active" | "parked" | "completed" | "superseded";
  unresolvedDependents: number;
  evidenceSuperseded: boolean;
  sessionId?: string;
  branchScope?: string;
}

export type LeaseDecision =
  | { action: "renew" }
  | { action: "release"; reason: "task-completed" | "evidence-superseded" | "budget-exhausted" | "unused" | "expired" | "scope-mismatch" };

export class LeasePolicy {
  constructor(private readonly cfg: LeasePolicyConfig) {}

  next(lease: RetrievalLease, state: LeaseDependencyState): LeaseDecision {
    const now = this.cfg.now ?? 0;
    if (lease.expiresAt <= now) return { action: "release", reason: "expired" };
    if (
      (state.sessionId && state.sessionId !== lease.sessionId) ||
      (state.branchScope && state.branchScope !== lease.branchScope)
    ) {
      return { action: "release", reason: "scope-mismatch" };
    }
    if (state.taskStatus === "completed" || state.taskStatus === "superseded") {
      return { action: "release", reason: "task-completed" };
    }
    if (state.evidenceSuperseded) return { action: "release", reason: "evidence-superseded" };
    if (lease.turns >= this.cfg.maxTurns || lease.tokenTurns >= this.cfg.maxTokenTurns) {
      return { action: "release", reason: "budget-exhausted" };
    }
    return state.unresolvedDependents > 0 ? { action: "renew" } : { action: "release", reason: "unused" };
  }
}

export function leaseAuthorityCeiling(): ActionAuthority {
  return "inform";
}
