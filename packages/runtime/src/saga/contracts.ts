import type { BlobRef, RuntimeCursor } from "@pcr/contracts";

export type SagaState =
  | "prepared"
  | "runtime_durable"
  | "host_visible"
  | "acknowledged"
  | "committed"
  | "stale"
  | "failed";

export interface SagaOperation {
  operationId: string;
  cursor: RuntimeCursor;
  kind: string;
  sourceContentHash: string;
  hostCorrelationId: string;
  rawBlobId: BlobRef;
  configFingerprint: string;
  signal?: AbortSignal;
}

export interface SagaRecord extends Omit<SagaOperation, "signal"> {
  state: SagaState;
  hostId?: string;
  revision: number;
}

export interface HostSnapshotEntry {
  hostId: string;
  hostCorrelationId: string;
  contentHash: string;
}

export interface HostSnapshot {
  cursor: RuntimeCursor;
  configFingerprint: string;
  entries: readonly HostSnapshotEntry[];
}

export interface RecoveryAction {
  operationId: string;
  from: SagaState | "absent";
  to: SagaState | "absent";
  reason:
    | "cursor-or-config-stale"
    | "content-hash-mismatch"
    | "host-entry-missing"
    | "host-id-mismatch"
    | "host-message-without-runtime-record"
    | "host-visibility-recovered";
  hostId?: string;
}

export interface RecoveryReport {
  actions: RecoveryAction[];
}

export interface SagaJournal {
  prepare(operation: SagaOperation): Promise<SagaRecord>;
  markHostVisible(id: string, hostId: string): Promise<void>;
  reconcile(snapshot: HostSnapshot): Promise<RecoveryReport>;
}

export interface DurableSagaJournal extends SagaJournal {
  get(operationId: string): Promise<SagaRecord | null>;
  close(): Promise<void>;
}

export interface SagaBlobVerifier {
  verify(cursor: RuntimeCursor, ref: BlobRef): Promise<void>;
}

export type SagaJournalErrorCode =
  | "PCR_SAGA_CLOSED"
  | "PCR_SAGA_CORRELATION_CONFLICT"
  | "PCR_SAGA_DEPENDENCY_MISSING"
  | "PCR_SAGA_HOST_CONFLICT"
  | "PCR_SAGA_INPUT_INVALID"
  | "PCR_SAGA_INVALID_TRANSITION"
  | "PCR_SAGA_NOT_FOUND"
  | "PCR_SAGA_OPERATION_CONFLICT"
  | "PCR_SAGA_STORAGE_BUSY"
  | "PCR_SAGA_STORAGE_FAILURE"
  | "PCR_SAGA_WORKSPACE_MISMATCH";

export class SagaJournalError extends Error {
  readonly code: SagaJournalErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SagaJournalErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "SagaJournalError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
