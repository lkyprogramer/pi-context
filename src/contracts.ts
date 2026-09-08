import { createHash } from "node:crypto";

export type Profile = "off" | "observe" | "balanced";
export type ResultCode =
  | "ok"
  | "disabled"
  | "denied"
  | "source-missing"
  | "source-changed"
  | "stale-ref"
  | "stale-cursor"
  | "insufficient-context"
  | "degraded"
  | "unsupported";
export type Sha256 = string;
export type EntryId = string;
export type SourceRef = string;

export interface PctxConfig {
  schemaVersion: 6;
  profile: Profile;
  storage: { mode: "persistent" | "memory-only"; dbPath: string | null; maxIndexBytes: number };
  history: { searchLimit: number; searchMaxTokens: number; readMaxTokens: number; readMaxBytes: number };
  fold: {
    triggerPercent: number;
    targetPercent: number;
    protectRecentBatches: number;
    minRemovedTokens: number;
    minFoldableBytes: number;
    stubHeadChars: number;
  };
  telemetry: { includeContent: false; jsonl: boolean; maxLogBytes: number };
}

export interface RequestRecord {
  at: string;
  sessionId: string;
  profile: PctxConfig["profile"];
  planId: string | null;
  replacementsApplied: number;
  contextPercentBefore: number | null;
  usage: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    totalTokens: number | null;
  };
  stopReason: string | null;
  ttftMs: number | null;
}

export interface StatusView {
  resolvedProfile: string;
  configHash: string;
  configSource: string;
  warnings: string[];
  hostVersion: string;
  contextWindow: number | null;
  contextPercent: number | null;
  activePlan: { planId: string; replacements: number; savedTokensEstimate: number } | null;
  folds: number;
  nativeCompactions: number;
  historyReads: number;
  historySearches: number;
  lastRequests: RequestRecord[];
  indexMode: string;
  dbPath: string | null;
  indexRows: number;
  indexBytes: number;
  lastIndexedLeaf: string | null;
}

export interface SearchCursor {
  v: 6;
  sessionId: string;
  branchHash: string;
  queryHash: string;
  indexRevision: string;
  offset: number;
}

export const ERROR = {
  CONFIG: "PCTX_CONFIG",
  REF: "PCTX_REF",
  SCOPE: "PCTX_SCOPE",
  CYCLE: "PCTX_CYCLE",
  UTF8: "PCTX_UTF8",
} as const;

export function sha256Hex(value: string | Uint8Array): Sha256 {
  return createHash("sha256").update(value).digest("hex");
}

export function isSha256(value: string): value is Sha256 {
  return /^[0-9a-f]{64}$/.test(value);
}

export function canonicalJson(value: unknown, stack = new Set<unknown>()): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (stack.has(value)) {
    const err = new Error("cyclic value");
    (err as { code?: string }).code = ERROR.CYCLE;
    throw err;
  }
  stack.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => canonicalJson(item, stack)).join(",")}]`;
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k], stack)}`).join(",")}}`;
  } finally {
    stack.delete(value);
  }
}

export function hashCanonical(value: unknown): Sha256 {
  return sha256Hex(canonicalJson(value));
}

export interface Scope {
  workspaceId: string;
  worktreeId?: string;
  sessionId: string;
  leafId: string | null;
  visibleEntryIds: ReadonlySet<EntryId>;
}

export type RefErrorCode = "REF_OUT_OF_RANGE" | "REF_KIND" | "REF_ENTRY" | "REF_SCOPE" | "REF_VERSION";

export interface RefError {
  code: RefErrorCode;
}

export interface FieldRef {
  v: 6;
  workspaceId: string;
  sessionId: string;
  entryId: string;
  blockIndex: number;
  kind: "text" | "image";
  sourceHash: Sha256;
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

export interface TokenEstimate {
  value: number;
  method: "provider" | "tokenizer" | "character-estimate";
  includesImages: boolean;
  upperBoundKnown: boolean;
}

export interface ReadBudget {
  maxTokens: number;
  maxBytes: number;
  estimateKind: "provider-window" | "character-estimate";
}

export interface HistoryResult {
  code: ResultCode;
  ok?: boolean;
  hits?: SearchHit[];
  page?: string;
  image?: { type: "image"; mimeType: string; data: string };
  cursor: string | null;
  nextCursor?: string | null;
  byteOffset?: number;
  nextByteOffset?: number | null;
  totalBytes?: number;
  sourceHash?: string;
  verified?: boolean;
  diagnostic?: string;
  details?: unknown;
}

export type BudgetDecision =
  | { kind: "within"; optionalTokens: number; remainingOptionalTokens: number }
  | { kind: "bypass"; reason: "budget-unachievable-without-loss" | "unknown-content-cost" };

export interface EvalArm {
  arm: "B0" | "B1" | "B2" | "B3";
  status: "complete" | "timeout" | "blocked" | "failed" | "not-run";
  taskPassed: boolean | null;
  criticalViolation: boolean | null;
  wallMs: number | null;
  monetaryCost: number | null;
  billedTokens?: number | null;
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

export interface UsageRecord {
  provider: string;
  model: string;
  purpose: "agent" | "compaction" | "semantic" | "retry";
  raw: unknown;
  uncachedInputTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
  outputTokens: number | null;
  monetaryCost: number | null;
  currency: string | null;
  pricingIdentity: string | null;
  complete: boolean;
}

export interface ContentBlock {
  type: string;
  text?: string;
  mimeType?: string;
  data?: string;
  [key: string]: unknown;
}

export interface NativeEntry {
  id: EntryId;
  parentId: EntryId | null;
  type: string;
  timestamp?: number;
  message?: {
    role?: string;
    content?: ContentBlock[] | string;
    stopReason?: string;
    errorMessage?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
  };
  customType?: string;
  data?: unknown;
}

export function utf8Bytes(text: string): Buffer {
  return Buffer.from(text, "utf8");
}

export function utf8Slice(text: string, startByte: number, endByteExclusive: number): string {
  const buf = utf8Bytes(text);
  if (startByte < 0 || endByteExclusive < startByte || endByteExclusive > buf.length) {
    const err = new Error("utf-8 range out of bounds");
    (err as { code?: string }).code = ERROR.UTF8;
    throw err;
  }
  if (startByte > 0 && (buf[startByte] & 0xc0) === 0x80) {
    const err = new Error("utf-8 start splits a character");
    (err as { code?: string }).code = ERROR.UTF8;
    throw err;
  }
  if (endByteExclusive < buf.length && (buf[endByteExclusive] & 0xc0) === 0x80) {
    const err = new Error("utf-8 end splits a character");
    (err as { code?: string }).code = ERROR.UTF8;
    throw err;
  }
  return buf.subarray(startByte, endByteExclusive).toString("utf8");
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(utf8Bytes(text).length / 4));
}
