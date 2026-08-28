import { domainHash, type ActionAuthority } from "../../../contracts/src/index.js";

export type ClaimType =
  | "goal"
  | "constraint"
  | "decision"
  | "outcome"
  | "file-state"
  | "error-state"
  | "validation"
  | "preference";

export type ClaimPolarity = "must" | "must-not" | "is" | "is-not" | "unknown";
export type ClaimStatus = "active" | "superseded" | "resolved" | "retracted" | "contested";
export type ClaimAdmissionClass = "supported" | "inference" | "proposal";

export interface TimeRange {
  start: number;
  end?: number | null;
}

export interface Claim {
  claimId: string;
  key: string;
  claimType: ClaimType;
  value: unknown;
  polarity: ClaimPolarity;
  status: ClaimStatus;
  validTime?: TimeRange;
  systemTime: TimeRange;
  support: string[];
  authority: ActionAuthority;
  supersedes: string[];
  conflictsWith: string[];
}

export interface ClaimAdmission {
  key: string;
  claimType: ClaimType;
  value: unknown;
  polarity?: ClaimPolarity;
  validFrom?: number;
  validUntil?: number | null;
  systemFrom?: number;
  supportIds: string[];
  transformerCeiling: ActionAuthority;
  admissionClass?: ClaimAdmissionClass;
  supersedes?: string[];
  conflictsWith?: string[];
}

export interface ClaimAsOfQuery {
  validAt: number;
  systemAt: number;
  policy?: "current" | "include-retracted";
}

export interface ClaimSupport {
  evidenceId: string;
  authority: ActionAuthority;
}

export function inTimeRange(range: TimeRange | undefined, at: number): boolean {
  if (!range) return true;
  if (at < range.start) return false;
  return range.end == null || at < range.end;
}

export function claimVisibleAsOf(claim: Claim, query: ClaimAsOfQuery): boolean {
  if (!inTimeRange(claim.validTime, query.validAt)) return false;
  if (inTimeRange(claim.systemTime, query.systemAt)) return true;
  return query.policy === "include-retracted" && claim.status === "retracted";
}

export function canonicalClaim(input: ClaimAdmission & { authority: ActionAuthority; status?: ClaimStatus }): Claim {
  const validFrom = input.validFrom ?? 0;
  const systemFrom = input.systemFrom ?? 0;
  const support = [...input.supportIds];
  return {
    claimId: `cl_${domainHash("claim", {
      key: input.key,
      claimType: input.claimType,
      value: input.value,
      validFrom,
      systemFrom,
      support,
    })}`,
    key: input.key,
    claimType: input.claimType,
    value: input.value,
    polarity: input.polarity ?? "is",
    status: input.status ?? "active",
    validTime: { start: validFrom, end: input.validUntil ?? null },
    systemTime: { start: systemFrom, end: null },
    support,
    authority: input.authority,
    supersedes: input.supersedes ?? [],
    conflictsWith: input.conflictsWith ?? [],
  };
}
