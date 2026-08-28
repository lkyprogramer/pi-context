export interface StoredEvidence {
  evidenceId: string;
  contentHash: string;
  workspaceId: string;
}

export interface EvidencePut {
  evidenceId: string;
  contentHash: string;
}

export interface StorageTransaction {
  putEvidence(input: EvidencePut): Promise<void>;
}

export interface StorageRpc {
  transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T>;
  getEvidence(id: string): Promise<StoredEvidence | null>;
  close(): Promise<void>;
}

export interface OpenStoreInput {
  path: string;
  workspaceId: string;
}

export type SagaState = "prepared" | "host-visible" | "acknowledged" | "committed" | "stale" | "quarantined";

export interface SagaOperation {
  operationId: string;
  kind: string;
  state: SagaState;
  sourceContentHash: string;
  hostCorrelationId: string;
  branchScope: string;
  rawBlobId?: string;
  hostRef?: string;
  receiptId?: string;
}

export interface SagaPrepareInput {
  operationId: string;
  kind: string;
  sourceContentHash: string;
  hostCorrelationId: string;
  rawBlobId?: string;
  branchScope?: string;
  cursor?: unknown;
}

export interface HostJournalEntry {
  hostCorrelationId: string;
  contentHash: string;
  hostRef: string;
  branchScope: string;
}

export interface HostJournalView {
  findByCorrelation(hostCorrelationId: string): HostJournalEntry | undefined;
  list(): HostJournalEntry[];
}

export interface RecoveryAction {
  operationId: string;
  from: SagaState | "absent";
  to: SagaState | "absent";
  reason: string;
}

export interface RecoveryReport {
  actions: RecoveryAction[];
}

export interface LiteralTokenFilter {
  statuses?: string[];
  after?: number;
  before?: number;
}

export interface EvidenceAdmissionRecord {
  evidenceId: string;
  sourceClass: string;
  authority: string;
  contentHash: string;
}

export interface StoredDirective {
  directiveId: string;
  quote: string;
  status: string;
  sourceContentHash: string;
}
