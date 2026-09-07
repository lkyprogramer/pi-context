/** Normative v5 design types, NOT a plugin implementation. No private Pi imports. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Profile = "off" | "observe" | "balanced" | "experimental-semantic";
export type ResultCode = "ok" | "disabled" | "denied" | "source-missing" |
  "source-changed" | "stale-cursor" | "insufficient-context" | "degraded";
export type Sha256 = string; // Runtime: lowercase 64 hex, no truthiness-only validation.
export type EntryId = string;
export type SourceRef = string; // Opaque, versioned; still requires runtime authorization.
export interface Scope {
  workspaceId: string;
  worktreeId: string;
  sessionId: string;
  visibleEntryIds: ReadonlySet<EntryId>;
}
export interface SnapshotKey {
  generation: number;
  sessionId: string;
  leafId: EntryId | null;
  sourceRevision: Sha256;
  modelIdentity: string;
  configHash: Sha256;
}
export interface SourceLocator {
  version: 5;
  workspaceId: string;
  sessionId: string;
  entryId: EntryId;
  field: { kind: "text"; blockIndex: number } | { kind: "image"; blockIndex: number };
  sourceHash: Sha256;
}
export interface HistoricalTextPage {
  kind: "text-range-exact";
  ref: SourceRef;
  text: string;
  startByte: number;
  endByteExclusive: number;
  totalBytes: number;
  sourceHash: Sha256;
  pageHash: Sha256;
  cursor: string | null;
  observedAt: string;
  currentStateVerified: false;
}
export interface SearchHit {
  ref: SourceRef;
  entryId: EntryId;
  excerpt: string;
  fidelity: "normalized-search-excerpt";
  observedAt: string;
  currentStateVerified: false;
}
export type HistoryRequest =
  | { action: "search"; query: string; limit?: number; cursor?: string | null }
  | { action: "read"; ref: SourceRef; cursor?: string | null; maxTokens?: number };
export interface HistoryResult {
  code: ResultCode;
  hits?: SearchHit[];
  page?: HistoricalTextPage;
  image?: { type: "image"; mimeType: string; data: string };
  cursor: string | null;
  diagnostic?: string; // No source text or secrets in failure diagnostics.
}
export interface ExposureAttempt {
  attemptId: string;
  snapshot: SnapshotKey;
  includedOriginalRefs: readonly SourceRef[];
  startedAtMs: number;
}
export interface ExposureLedger {
  begin(attempt: ExposureAttempt): void;
  confirm(attemptId: string, snapshot: SnapshotKey, outcome: "stop" | "toolUse"): void;
  fail(attemptId: string): void;
  isExposed(ref: SourceRef, generation: number): boolean;
  invalidate(generation: number): void;
}
export interface ToolBatch {
  id: string;
  assistantEntryId: EntryId;
  toolCallIds: readonly string[];
  resultEntryIds: readonly EntryId[];
  complete: boolean;
  hasUnexposedResult: boolean;
  hasImageOrUnknown: boolean;
  unresolvedFailure: boolean;
}
export interface Replacement {
  entryId: EntryId;
  ref: SourceRef;
  originalHash: Sha256;
  replacementText: string;
  estimatedBeforeTokens: number;
  estimatedAfterTokens: number;
}
export interface FrozenPlan {
  epochId: string;
  snapshot: SnapshotKey;
  sourceBoundary: EntryId | null;
  replacements: readonly Replacement[];
  firstChangedMessageIndex: number | null;
  planHash: Sha256;
}
export interface TokenEstimate {
  value: number;
  method: "provider" | "tokenizer" | "character-estimate";
  includesImages: boolean;
  upperBoundKnown: boolean;
}
export type BudgetDecision =
  | { kind: "within"; optionalTokens: number; remainingOptionalTokens: number }
  | { kind: "bypass"; reason: "budget-unachievable-without-loss" | "unknown-content-cost" };
export interface Pin {
  pinId: string;
  source: SourceLocator;
  startByte: number;
  endByteExclusive: number;
  quoteHash: Sha256;
  createdByEntryId: EntryId;
  state: "active" | "released";
}
export interface Capsule {
  snapshot: SnapshotKey;
  nativeCompactionEntryId: EntryId;
  text: string;
  evidenceRefs: readonly SourceRef[];
  hash: Sha256;
  estimatedTokens: number;
  unverifiedClaims: readonly string[];
}
export interface CompactionProposal {
  id: string;
  snapshot: SnapshotKey;
  firstKeptEntryId: EntryId;
  summary: string;
  summaryHash: Sha256;
  usage: UsageRecord;
}
export interface HostCompactionAck {
  proposalId: string;
  sessionId: string;
  actualEntryId: EntryId;
  firstKeptEntryId: EntryId;
  summaryHash: Sha256;
}
export interface UsageRecord {
  provider: string;
  model: string;
  purpose: "agent" | "compaction" | "semantic" | "retry";
  raw: Json;
  uncachedInputTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
  outputTokens: number | null;
  monetaryCost: number | null;
  currency: string | null;
  pricingIdentity: string | null;
  complete: boolean;
}
export interface EvalArm {
  arm: "B0" | "B1" | "B2" | "B3";
  status: "complete" | "timeout" | "blocked" | "failed" | "not-run";
  taskPassed: boolean | null;
  criticalViolation: boolean | null;
  wallMs: number | null;
  monetaryCost: number | null;
}
export interface EvalPair {
  kind: "real-run" | "synthetic-example";
  taskId: string;
  clusterId: string;
  repetition: number;
  provenance: "real-independent" | "adapted-real" | "synthetic";
  baseline: EvalArm;
  candidate: EvalArm;
}
