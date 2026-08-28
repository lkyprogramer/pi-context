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

export interface StoredClaimRecord {
  claimId: string;
  key: string;
  claimType: string;
  polarity: string;
  status: string;
  authority: string;
  value: unknown;
  validStart?: number | null;
  validEnd?: number | null;
  systemStart: number;
  systemEnd?: number | null;
  supportIds: string[];
  supersedes: string[];
  conflictsWith: string[];
}

export interface ClaimWriteStore {
  insertClaim(claim: StoredClaimRecord): Promise<void>;
  listClaims(): Promise<StoredClaimRecord[]>;
}

export interface StoredContinuityRevision {
  revisionId: string;
  parentRevisionId?: string | null;
  payload: unknown;
  contentHash: string;
}

export interface StoredRetrievalLease {
  leaseId: string;
  pageId: string;
  purpose: string;
  sessionId: string;
  branchScope: string;
  authority: string;
  turns: number;
  tokenTurns: number;
  expiresAt: number;
  omittedReason?: string;
}

export interface StoredDirective {
  directiveId: string;
  quote: string;
  status: string;
  sourceContentHash: string;
}

export type GenerationState = "prepared" | "committed" | "stale" | "rejected";

export interface ContextHead {
  hash: string;
  generationId?: string;
  fencingKey: string;
}

export interface GenerationManifest {
  generationId: string;
  candidateKey: string;
  sourceHead: string;
  fencingKey: string;
  schemaVersion: string;
  configFingerprint: string;
  reducerRevisionSet: string;
  modelKey: string;
}

export interface PublishResult {
  kind: "committed" | "stale" | "rejected";
  reason?: string;
  head?: ContextHead;
  receipt?: { generationId: string; headHash: string };
}

export interface GenerationTransaction {
  getContextHead(cursor: unknown): Promise<ContextHead>;
  markGenerationStale(generationId: string, reason: string): Promise<PublishResult>;
  compareAndSwapContextHead(expectedHash: string, next: ContextHead, generationId: string): Promise<PublishResult>;
  insertGeneration?(manifest: GenerationManifest, state: GenerationState): Promise<void>;
  getGeneration?(generationId: string): Promise<{ state: GenerationState; manifest: GenerationManifest } | undefined>;
}

export interface GenerationStore {
  rejectGeneration(generationId: string, reason: string): Promise<PublishResult>;
  transaction<T>(work: (tx: GenerationTransaction) => Promise<T>): Promise<T>;
}
