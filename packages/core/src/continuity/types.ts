import type { RuntimeCursor, SourceClass, TaskFronts } from "@pcr/contracts";

export const CONTINUITY_FRONT_LIMIT = 64;

export interface ContinuityRevision {
  revisionId: string;
  parentRevisionId: string | null;
  contentHash: string;
  cursor: RuntimeCursor;
  taskFronts: TaskFronts;
  nextSafeActions: Array<{ text: string; requires: string[] }>;
}

export type ContinuitySnapshot = ContinuityRevision;

export type ContinuityEvent =
  | { type: "open-front"; cursor: RuntimeCursor; title: string; evidenceId?: string; signal?: AbortSignal }
  | { type: "user-goal-change"; cursor: RuntimeCursor; newGoal: string; evidenceId?: string; signal?: AbortSignal }
  | { type: "park-front"; cursor: RuntimeCursor; frontId: string; signal?: AbortSignal }
  | { type: "complete-front"; cursor: RuntimeCursor; frontId: string; evidenceId: string; signal?: AbortSignal }
  | { type: "supersede-front"; cursor: RuntimeCursor; frontId: string; replacementTitle: string; evidenceId?: string; signal?: AbortSignal }
  | { type: "reactivate-front"; cursor: RuntimeCursor; frontId: string; evidenceId: string; sourceClass: SourceClass; signal?: AbortSignal };

export interface ContinuityStore {
  put(revision: ContinuityRevision): Promise<void>;
  head(cursor: RuntimeCursor): Promise<ContinuityRevision | null>;
}

export interface ContinuityService {
  apply(event: ContinuityEvent): Promise<ContinuityRevision>;
  current(cursor: RuntimeCursor): Promise<ContinuitySnapshot>;
}

export interface CreateContinuityMachineInput {
  cursor: RuntimeCursor;
  store: ContinuityStore;
}

export type ContinuityErrorCode =
  | "PCR_CONTINUITY_DEPENDENCY_MISSING"
  | "PCR_CONTINUITY_INPUT_INVALID"
  | "PCR_CONTINUITY_SCOPE_MISMATCH"
  | "PCR_CONTINUITY_TRANSITION_INVALID"
  | "PCR_CONTINUITY_OVERFLOW";

export class ContinuityError extends TypeError {
  readonly code: ContinuityErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContinuityErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ContinuityError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
