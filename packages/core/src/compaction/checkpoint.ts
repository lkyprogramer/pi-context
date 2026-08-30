import {
  domainHash,
  type CheckpointV2,
  type DirectiveRecord,
  type RuntimeCursor,
} from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASONS = new Set(["threshold", "overflow", "manual"]);

export interface CompactionSnapshotClaim {
  claimId: string;
  key: string;
  polarity: string;
  status: string;
  value: unknown;
}

export interface CompactionSnapshotPointer {
  ref: string;
  kind: string;
}

export interface CompactionSnapshotHeads {
  contextHead: string;
  directiveHead: string;
  claimHead: string;
  continuityHead: string;
  catalogHead: string;
}

export interface CompactionSnapshotContinuity {
  revisionId: string;
  parentRevisionId: string | null;
  contentHash: string;
  cursor: RuntimeCursor;
  taskFronts: {
    active: unknown[];
    parked: unknown[];
    completed: unknown[];
    superseded: unknown[];
  };
  nextSafeActions: unknown[];
}

export interface CompactionSnapshot {
  snapshotHash: string;
  cursor: RuntimeCursor;
  assembledAt: number;
  reason: "threshold" | "overflow" | "manual";
  directives: readonly DirectiveRecord[];
  continuity: CompactionSnapshotContinuity;
  claims: readonly CompactionSnapshotClaim[];
  pointers: readonly CompactionSnapshotPointer[];
  heads: CompactionSnapshotHeads;
}

export interface VerificationIssue {
  code: string;
  path?: string;
}

export interface VerificationReport {
  ok: boolean;
  outputHash: string;
  issues: readonly VerificationIssue[];
}

export interface CheckpointRenderer {
  render(snapshot: CompactionSnapshot, signal?: AbortSignal): Promise<CheckpointV2>;
}

export interface CheckpointVerifier {
  verify(snapshot: CompactionSnapshot, candidate: CheckpointV2, signal?: AbortSignal): Promise<VerificationReport>;
}

export interface CheckpointPointerCheck {
  verify(
    cursor: RuntimeCursor,
    pointers: readonly CompactionSnapshotPointer[],
    signal?: AbortSignal,
  ): Promise<void>;
}

export interface CreateCheckpointRendererInput {
  cursor: RuntimeCursor;
}

export interface CreateCheckpointVerifierInput {
  cursor: RuntimeCursor;
  pointers: CheckpointPointerCheck;
}

export type CheckpointErrorCode =
  | "PCR_CHECKPOINT_DEPENDENCY_MISSING"
  | "PCR_CHECKPOINT_INPUT_INVALID"
  | "PCR_CHECKPOINT_SCOPE_MISMATCH";

export class CheckpointError extends TypeError {
  readonly code: CheckpointErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CheckpointErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CheckpointError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CheckpointError("PCR_CHECKPOINT_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CheckpointError("PCR_CHECKPOINT_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function requireFunction(value: unknown, dependency: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") failMissing(dependency);
}

function copyDirective(record: DirectiveRecord): DirectiveRecord {
  return Object.freeze({
    ...record,
    utf8ByteRange: { ...record.utf8ByteRange },
    utf16Range: { ...record.utf16Range },
    codePointRange: { ...record.codePointRange },
  }) as DirectiveRecord;
}

function copyClaim(claim: CompactionSnapshotClaim): CompactionSnapshotClaim {
  return Object.freeze({
    claimId: claim.claimId,
    key: claim.key,
    polarity: claim.polarity,
    status: claim.status,
    value: claim.value,
  });
}

function copyPointer(pointer: CompactionSnapshotPointer): CompactionSnapshotPointer {
  return Object.freeze({ ref: pointer.ref, kind: pointer.kind });
}

function parseSnapshot(value: CompactionSnapshot, field: string): CompactionSnapshot {
  if (!value || typeof value !== "object") failInput(field);
  requireNonEmpty(value.snapshotHash, `${field}.snapshotHash`);
  if (!SHA256_PATTERN.test(value.snapshotHash)) failInput(`${field}.snapshotHash`);
  if (typeof value.assembledAt !== "number" || !Number.isFinite(value.assembledAt)) failInput(`${field}.assembledAt`);
  if (typeof value.reason !== "string" || !REASONS.has(value.reason)) failInput(`${field}.reason`);
  if (!Array.isArray(value.directives)) failInput(`${field}.directives`);
  if (!value.continuity || typeof value.continuity !== "object") failInput(`${field}.continuity`);
  requireNonEmpty(value.continuity.revisionId, `${field}.continuity.revisionId`);
  if (!Array.isArray(value.claims)) failInput(`${field}.claims`);
  if (!Array.isArray(value.pointers)) failInput(`${field}.pointers`);
  if (!value.heads || typeof value.heads !== "object") failInput(`${field}.heads`);
  return value;
}

function parseCandidate(value: CheckpointV2, field: string): CheckpointV2 {
  if (!value || typeof value !== "object") failInput(field);
  if (value.version !== 2) failInput(`${field}.version`);
  requireNonEmpty(value.snapshotHash, `${field}.snapshotHash`);
  if (!Array.isArray(value.directives)) failInput(`${field}.directives`);
  if (!value.continuity || typeof value.continuity !== "object") failInput(`${field}.continuity`);
  if (!Array.isArray(value.claims)) failInput(`${field}.claims`);
  if (!Array.isArray(value.pointers)) failInput(`${field}.pointers`);
  if (!value.heads || typeof value.heads !== "object") failInput(`${field}.heads`);
  return value;
}

function stableEqual(left: unknown, right: unknown): boolean {
  return domainHash("checkpoint-eq", left) === domainHash("checkpoint-eq", right);
}

export function createCheckpointRenderer(input: CreateCheckpointRendererInput): CheckpointRenderer {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  return {
    async render(snapshot: CompactionSnapshot, signal?: AbortSignal): Promise<CheckpointV2> {
      if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
      signal?.throwIfAborted();
      const source = parseSnapshot(snapshot, "snapshot");
      const cursor = snapshotCursor(source.cursor, "snapshot.cursor");
      if (!sameCursor(bound, cursor)) throw new CheckpointError("PCR_CHECKPOINT_SCOPE_MISMATCH");
      signal?.throwIfAborted();
      const directives = source.directives.map((item, index) => {
        if (!item || typeof item !== "object") failInput(`snapshot.directives[${index}]`);
        requireNonEmpty(item.directiveId, `snapshot.directives[${index}].directiveId`);
        return copyDirective(item);
      });
      const claims = source.claims.map((item, index) => {
        if (!item || typeof item !== "object") failInput(`snapshot.claims[${index}]`);
        requireNonEmpty(item.claimId, `snapshot.claims[${index}].claimId`);
        return copyClaim(item);
      });
      const pointers = source.pointers.map((item, index) => {
        if (!item || typeof item !== "object") failInput(`snapshot.pointers[${index}]`);
        requireNonEmpty(item.ref, `snapshot.pointers[${index}].ref`);
        requireNonEmpty(item.kind, `snapshot.pointers[${index}].kind`);
        return copyPointer(item);
      });
      const continuity = Object.freeze({
        revisionId: source.continuity.revisionId,
        parentRevisionId: source.continuity.parentRevisionId ?? null,
        contentHash: source.continuity.contentHash,
        taskFronts: source.continuity.taskFronts,
        nextSafeActions: source.continuity.nextSafeActions,
      });
      const heads = Object.freeze({ ...source.heads });
      return Object.freeze({
        version: 2 as const,
        snapshotHash: source.snapshotHash,
        directives,
        continuity: { ...continuity },
        claims: claims.map((item) => ({ ...item })),
        pointers: pointers.map((item) => ({ ...item })),
        heads: { ...heads },
      });
    },
  };
}

export function createCheckpointVerifier(input: CreateCheckpointVerifierInput): CheckpointVerifier {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.pointers || typeof input.pointers !== "object") failMissing("pointers");
  requireFunction(input.pointers.verify, "pointers.verify");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const pointers = input.pointers;
  return {
    async verify(
      snapshot: CompactionSnapshot,
      candidate: CheckpointV2,
      signal?: AbortSignal,
    ): Promise<VerificationReport> {
      if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
      signal?.throwIfAborted();
      const source = parseSnapshot(snapshot, "snapshot");
      const cursor = snapshotCursor(source.cursor, "snapshot.cursor");
      if (!sameCursor(bound, cursor)) throw new CheckpointError("PCR_CHECKPOINT_SCOPE_MISMATCH");
      const rendered = parseCandidate(candidate, "candidate");
      signal?.throwIfAborted();
      await pointers.verify(cursor, source.pointers, signal);
      signal?.throwIfAborted();
      const issues: VerificationIssue[] = [];
      if (rendered.snapshotHash !== source.snapshotHash) {
        issues.push({ code: "PCR_CHECKPOINT_SNAPSHOT_HASH_MISMATCH", path: "snapshotHash" });
      }
      const byId = new Map(rendered.directives.map((item) => [item.directiveId, item]));
      for (const [index, expected] of source.directives.entries()) {
        const actual = byId.get(expected.directiveId);
        if (!actual) {
          issues.push({ code: "PCR_CHECKPOINT_DIRECTIVE_MISSING", path: `directives[${index}]` });
          continue;
        }
        if (
          actual.kind !== expected.kind
          || actual.polarity !== expected.polarity
          || actual.status !== expected.status
          || actual.exactQuote !== expected.exactQuote
          || actual.key !== expected.key
          || actual.value !== expected.value
        ) {
          issues.push({ code: "PCR_CHECKPOINT_DIRECTIVE_REWRITTEN", path: `directives[${index}]` });
        }
      }
      if (!stableEqual(rendered.claims, source.claims)) {
        issues.push({ code: "PCR_CHECKPOINT_CLAIMS_MISMATCH", path: "claims" });
      }
      if (!stableEqual(rendered.pointers, source.pointers)) {
        issues.push({ code: "PCR_CHECKPOINT_POINTERS_MISMATCH", path: "pointers" });
      }
      if (!stableEqual(rendered.heads, source.heads)) {
        issues.push({ code: "PCR_CHECKPOINT_HEADS_MISMATCH", path: "heads" });
      }
      return Object.freeze({
        ok: issues.length === 0,
        outputHash: domainHash("checkpoint-v2", rendered),
        issues: Object.freeze(issues),
      });
    },
  };
}
