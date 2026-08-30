import {
  RecallError,
  createProactiveRecallPolicy as createCoreRecallPolicy,
  snapshotRecallCursor,
  type CreateProactiveRecallPolicyInput,
  type ProactiveRecallPolicy,
  type RecallCatalog,
  type RecallDecision,
  type RecallDecisionInput,
  type RecallHit,
  type RecallLease,
  type RecallLeasePort,
} from "@pcr/core";
import { domainHash, type ActionAuthority, type RuntimeCursor } from "@pcr/contracts";

export {
  type ProactiveRecallPolicy,
  type RecallCatalog,
  type RecallDecision,
  type RecallDecisionInput,
  type RecallHit,
  type RecallLease,
};

export interface LeaseRecord extends RecallLease {
  cursor: RuntimeCursor;
}

export interface LeaseStore {
  put(lease: LeaseRecord): Promise<void>;
  get(cursor: RuntimeCursor, leaseId: string): Promise<LeaseRecord | null>;
  findByPage(cursor: RuntimeCursor, pageId: string): Promise<LeaseRecord | null>;
  delete(cursor: RuntimeCursor, leaseId: string): Promise<void>;
  list(cursor: RuntimeCursor): Promise<LeaseRecord[]>;
}

export interface LeaseLimits {
  maxTurns: number;
  maxTokenTurns: number;
  ttlMs: number;
}

export interface CreateLeaseServiceInput {
  cursor: RuntimeCursor;
  store: LeaseStore;
  clock: { now(): number };
  limits: LeaseLimits;
}

export interface LeaseService extends RecallLeasePort {
  grant(input: {
    cursor: RuntimeCursor;
    pageId: string;
    purpose: string;
    requestedAuthority?: ActionAuthority;
    signal?: AbortSignal;
  }): Promise<LeaseRecord>;
  active(cursor: RuntimeCursor, signal?: AbortSignal): Promise<LeaseRecord[]>;
}

export type LeaseServiceErrorCode =
  | "PCR_LEASE_DEPENDENCY_MISSING"
  | "PCR_LEASE_INPUT_INVALID"
  | "PCR_LEASE_SCOPE_MISMATCH"
  | "PCR_RECALL_DEPENDENCY_MISSING"
  | "PCR_RECALL_INPUT_INVALID"
  | "PCR_RECALL_SCOPE_MISMATCH";

export class LeaseServiceError extends TypeError {
  readonly code: LeaseServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: LeaseServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "LeaseServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new LeaseServiceError("PCR_LEASE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new LeaseServiceError("PCR_LEASE_INPUT_INVALID", { field });
}

function mapError(error: unknown): never {
  if (error instanceof RecallError) {
    throw new LeaseServiceError(error.code, { ...error.details });
  }
  throw error;
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export function createLeaseService(input: CreateLeaseServiceInput): LeaseService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.store || typeof input.store.put !== "function" || typeof input.store.get !== "function"
    || typeof input.store.findByPage !== "function" || typeof input.store.delete !== "function"
    || typeof input.store.list !== "function") {
    failMissing("store");
  }
  if (!input.clock || typeof input.clock.now !== "function") failMissing("clock");
  if (!input.limits || typeof input.limits !== "object") failMissing("limits");
  if (!Number.isInteger(input.limits.maxTurns) || input.limits.maxTurns <= 0) failMissing("limits.maxTurns");
  if (!Number.isInteger(input.limits.maxTokenTurns) || input.limits.maxTokenTurns <= 0) failMissing("limits.maxTokenTurns");
  if (!Number.isInteger(input.limits.ttlMs) || input.limits.ttlMs <= 0) failMissing("limits.ttlMs");
  let bound: RuntimeCursor;
  try {
    bound = snapshotRecallCursor(input.cursor, "input.cursor");
  } catch (error) {
    mapError(error);
  }
  const store = input.store;
  const clock = input.clock;
  const limits = input.limits;

  function assertScope(cursor: RuntimeCursor, signal?: AbortSignal): RuntimeCursor {
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
    signal?.throwIfAborted();
    let scoped: RuntimeCursor;
    try {
      scoped = snapshotRecallCursor(cursor, "cursor");
    } catch (error) {
      mapError(error);
    }
    if (!sameCursor(bound, scoped)) throw new LeaseServiceError("PCR_LEASE_SCOPE_MISMATCH");
    return scoped;
  }

  return {
    async grant(event) {
      if (!event || typeof event !== "object") failInput("event");
      const cursor = assertScope(event.cursor, event.signal);
      if (typeof event.pageId !== "string" || event.pageId.length === 0) failInput("event.pageId");
      if (typeof event.purpose !== "string" || event.purpose.length === 0) failInput("event.purpose");
      const existing = await store.findByPage(cursor, event.pageId);
      const now = clock.now();
      if (!Number.isFinite(now)) failInput("clock.now");
      if (
        existing
        && existing.expiresAt > now
        && existing.turns < limits.maxTurns
        && existing.tokenTurns < limits.maxTokenTurns
      ) {
        return existing;
      }
      event.signal?.throwIfAborted();
      const lease: LeaseRecord = {
        leaseId: `ls_${domainHash("recall-lease", { cursor, pageId: event.pageId }).slice(0, 24)}`,
        pageId: event.pageId,
        purpose: event.purpose,
        authority: "inform",
        turns: 0,
        tokenTurns: 0,
        expiresAt: now + limits.ttlMs,
        cursor,
      };
      await store.put(lease);
      return lease;
    },
    async active(cursor, signal) {
      const scoped = assertScope(cursor, signal);
      return store.list(scoped);
    },
  };
}

export function createProactiveRecallPolicy(input: CreateProactiveRecallPolicyInput): ProactiveRecallPolicy {
  try {
    const policy = createCoreRecallPolicy(input);
    return {
      decide: async (event: RecallDecisionInput) => {
        try {
          return await policy.decide(event);
        } catch (error) {
          mapError(error);
        }
      },
    };
  } catch (error) {
    mapError(error);
  }
}
