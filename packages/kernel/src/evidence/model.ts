import { domainHash, type ActionAuthority, type EvidenceUnit, type SourceClass } from "../../../contracts/src/index.js";

export interface ReducerFact {
  kind: string;
  value: unknown;
  requestedAuthority?: ActionAuthority;
  validity?: { kind: string; at?: number };
}

export interface EvidenceAdmissionInput {
  sourceClass: SourceClass;
  reducerFacts: ReducerFact[];
  observationId?: string;
  rawBlobId?: string;
  observedAt?: number;
  originSourceClass?: SourceClass;
  commit?: boolean;
}

export function makeEvidenceId(observationId: string, index: number, fact: ReducerFact): string {
  return `ev_${domainHash("evidence", { observationId, index, kind: fact.kind, value: fact.value })}`;
}

export function minAuthority(left: ActionAuthority, right: ActionAuthority): ActionAuthority {
  const rank: Record<ActionAuthority, number> = { none: 0, inform: 1, propose: 2, act: 3 };
  return rank[left] <= rank[right] ? left : right;
}

export type { EvidenceUnit };
