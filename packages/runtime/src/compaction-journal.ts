import type { RuntimeCursor } from "@pcr/contracts";

export type CompactionStageState = "staged" | "acked" | "failed";

export interface StagedCompactionRecord {
  stageId: string;
  cursor: RuntimeCursor;
  outputHash: string;
  firstKeptEntryId: string;
  payloadJson: string;
  generation: number;
  state: CompactionStageState;
}

export interface CompactionJournal {
  stage(input: {
    cursor: RuntimeCursor;
    outputHash: string;
    firstKeptEntryId: string;
    payloadJson: string;
    now: number;
    signal?: AbortSignal;
  }): Promise<StagedCompactionRecord>;
  ack(input: {
    cursor: RuntimeCursor;
    outputHash: string;
    firstKeptEntryId: string;
    signal?: AbortSignal;
  }): Promise<StagedCompactionRecord>;
  fail(input: { cursor: RuntimeCursor; outputHash?: string; signal?: AbortSignal }): Promise<void>;
  pending(cursor: RuntimeCursor, signal?: AbortSignal): Promise<StagedCompactionRecord | null>;
}

export type CompactionJournalErrorCode =
  | "PCR_COMPACTION_JOURNAL_INPUT_INVALID"
  | "PCR_COMPACTION_JOURNAL_HASH_MISMATCH"
  | "PCR_COMPACTION_JOURNAL_GENERATION_CONFLICT"
  | "PCR_COMPACTION_JOURNAL_NOT_STAGED";

export class CompactionJournalError extends TypeError {
  readonly code: CompactionJournalErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CompactionJournalErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CompactionJournalError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
