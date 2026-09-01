import type {
  ActionAuthority,
  BlobRef,
  ByteRange,
  HostCheckpointDetails,
  HostContentBlock,
  HostMessage,
  MaterializedView,
  RuntimeCursor,
  SourceClass,
  UserTurnRecord,
} from "@pcr/contracts";

export interface RuntimeSessionScope {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
}

export interface CancellableRuntimeOperation {
  operationId: string;
  cursor: RuntimeCursor;
  signal?: AbortSignal;
}

export interface UserInputEvent extends CancellableRuntimeOperation {
  rawText: string;
  sourceClass: "authenticated-user" | "untrusted-user" | "agent-derived";
  capturedAt: number;
}

export interface UserInputReceipt extends Omit<UserTurnRecord, "userTurnId" | "hostMessageId"> {
  receiptId: string;
  operationId: string;
  status: "pending" | "handled";
}

export interface ToolObservation extends CancellableRuntimeOperation {
  toolCallId: string;
  toolName: string;
  args: unknown;
  content: HostContentBlock[];
  details: unknown;
  isError: boolean;
  capturedAt: number;
  sourceClass: Extract<SourceClass, "trusted-tool" | "untrusted-tool">;
  authority: ActionAuthority;
}

export interface ProjectedToolResult {
  operationId: string;
  observationId: string;
  rawBlobId: BlobRef;
  evidenceIds: string[];
  visibleContent: HostContentBlock[];
  isError: boolean;
  reducer: { id: string; revision: string };
}

export interface MaterializationRequest extends CancellableRuntimeOperation {
  canonicalMessages: readonly HostMessage[];
  currentContextWindow: number;
  maxOutputTokens: number;
  providerReservedTokens?: number;
  systemTokens?: number;
  toolsTokens?: number;
  imageReserveTokens?: number;
  reason: "normal" | "overflow-retry" | "manual-preview";
  now: number;
}

export interface UserInputPort {
  capture(input: UserInputEvent): Promise<UserInputReceipt>;
}

export interface ToolResultPort {
  ingest(input: ToolObservation): Promise<ProjectedToolResult>;
}

export interface MaterializationPort {
  materialize(input: MaterializationRequest): Promise<MaterializedView>;
}

export interface CompactionPrepareInput extends CancellableRuntimeOperation {
  reason: "threshold" | "overflow" | "manual";
  now: number;
  tokensBefore: number;
  firstKeptEntryId: string;
  messagesToSummarize?: unknown[];
  retainedTailTokens?: number;
}

export type SessionCompactionDecision =
  | {
    kind: "pcr";
    result: {
      firstKeptEntryId: string;
      summary: string;
      tokensBefore: number;
      estimatedTokensAfter: number;
      details: HostCheckpointDetails;
    };
  }
  | { kind: "native-fallback" }
  | { kind: "hard-stop"; code: string };

export interface CompactionAckInput extends CancellableRuntimeOperation {
  firstKeptEntryId: string;
  outputHash: string;
}

export interface CompactionPort {
  prepare(input: CompactionPrepareInput): Promise<SessionCompactionDecision>;
  acknowledge?(input: CompactionAckInput): Promise<void>;
}

export interface SearchRequest extends CancellableRuntimeOperation {
  text: string;
  limit?: number;
}

export interface SessionSearchHit {
  evidenceId: string;
  kind: string;
  rank: number;
  snippet?: string;
}

export interface ExactReadRequest extends CancellableRuntimeOperation {
  evidenceId: string;
  range?: ByteRange;
}

export interface SessionExactPage {
  evidenceId: string;
  rawBlobId: BlobRef;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  range: ByteRange;
  verified: true;
}

export interface RetrievalPort {
  search(input: SearchRequest): Promise<SessionSearchHit[]>;
  read(input: ExactReadRequest): Promise<SessionExactPage>;
}

export type RecoverSessionReason = "new" | "resume" | "fork" | "reload";

export interface RecoverRequest extends CancellableRuntimeOperation {
  reason: RecoverSessionReason;
  hasRawBlobs: boolean;
  hostSnapshot?: {
    cursor: RuntimeCursor;
    configFingerprint: string;
    entries: ReadonlyArray<{ hostId: string; hostCorrelationId: string; contentHash: string }>;
  };
}

export interface RecoverSessionReport {
  cursor: RuntimeCursor;
  catchUp: { reason: RecoverSessionReason; degraded: boolean; pointerUnavailable: boolean };
  saga: { actions: ReadonlyArray<{ operationId: string; from: string; to: string; reason: string; hostId?: string }> };
  candidatesInvalidated: number;
}

export interface BranchChangedEvent extends CancellableRuntimeOperation {
  previousCursor: RuntimeCursor;
  newLeafId: string;
}

export interface RecoveryPort {
  recover(input: RecoverRequest): Promise<RecoverSessionReport>;
  branchChanged(input: BranchChangedEvent): Promise<void>;
}

export interface BlobStore {
  put(cursor: RuntimeCursor, plain: Uint8Array): Promise<BlobRef>;
  read(cursor: RuntimeCursor, ref: BlobRef, range?: ByteRange): Promise<Uint8Array>;
}

export interface RuntimeSessionPorts {
  userInput: UserInputPort;
  toolResult: ToolResultPort;
  materialization: MaterializationPort;
  compaction?: CompactionPort;
  retrieval?: RetrievalPort;
  recovery?: RecoveryPort;
}

export interface RuntimeSession {
  ingestUserInput(input: UserInputEvent): Promise<UserInputReceipt>;
  ingestToolResult(input: ToolObservation): Promise<ProjectedToolResult>;
  materialize(input: MaterializationRequest): Promise<MaterializedView>;
  prepareCompaction?(input: CompactionPrepareInput): Promise<SessionCompactionDecision>;
  acknowledgeCompaction?(input: CompactionAckInput): Promise<void>;
  search?(input: SearchRequest): Promise<SessionSearchHit[]>;
  read?(input: ExactReadRequest): Promise<SessionExactPage>;
  branchChanged?(event: BranchChangedEvent): Promise<void>;
  recover?(reason: RecoverRequest): Promise<RecoverSessionReport>;
  close?(): Promise<void>;
}

export type RuntimeSessionErrorCode =
  | "PCR_RUNTIME_DEPENDENCY_MISSING"
  | "PCR_RUNTIME_INPUT_INVALID"
  | "PCR_RUNTIME_SCOPE_MISMATCH"
  | "PCR_RUNTIME_SESSION_CLOSED";

export class RuntimeSessionError extends TypeError {
  readonly code: RuntimeSessionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RuntimeSessionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RuntimeSessionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}
