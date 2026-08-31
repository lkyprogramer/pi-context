import { domainHash, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import type { ContinuityRevision } from "@pcr/core";

import type { CompactionClaim, CompactionPointer, CompactionSnapshotHeads } from "../compaction/snapshot.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface RuntimeSnapshot {
  cursor: RuntimeCursor;
  snapshotHash: string;
  sourceEntrySpan: { first: string; last: string };
  heads: CompactionSnapshotHeads;
  activeDirectives: DirectiveRecord[];
  claims: CompactionClaim[];
  continuity: ContinuityRevision;
  pointers: CompactionPointer[];
  schemaVersion: number;
  configFingerprint: string;
}

export interface RuntimeSnapshotRows {
  cursor: RuntimeCursor;
  directives: readonly DirectiveRecord[];
  claims: readonly CompactionClaim[];
  continuity: ContinuityRevision;
  pointers: readonly CompactionPointer[];
  sourceEntryIds: readonly string[];
  schemaVersion: number;
  configFingerprint?: string;
}

export interface RuntimeSnapshotReader {
  read(cursor: RuntimeCursor, signal?: AbortSignal): Promise<RuntimeSnapshotRows>;
}

export type RuntimeSnapshotErrorCode =
  | "PCR_RUNTIME_SNAPSHOT_DEPENDENCY_MISSING"
  | "PCR_RUNTIME_SNAPSHOT_INPUT_INVALID"
  | "PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH";

export class RuntimeSnapshotError extends TypeError {
  readonly code: RuntimeSnapshotErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RuntimeSnapshotErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RuntimeSnapshotError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new RuntimeSnapshotError("PCR_RUNTIME_SNAPSHOT_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new RuntimeSnapshotError("PCR_RUNTIME_SNAPSHOT_INPUT_INVALID", { field });
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): RuntimeCursor {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  if (typeof cursor.sessionId !== "string" || cursor.sessionId.length === 0) failInput(`${field}.sessionId`);
  if (cursor.leafId !== null && (typeof cursor.leafId !== "string" || cursor.leafId.length === 0)) {
    failInput(`${field}.leafId`);
  }
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  if (typeof cursor.modelKey !== "string" || cursor.modelKey.length === 0) failInput(`${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function deriveHeads(
  cursor: RuntimeCursor,
  directives: readonly DirectiveRecord[],
  continuity: ContinuityRevision,
  claims: readonly CompactionClaim[],
  pointers: readonly CompactionPointer[],
): CompactionSnapshotHeads {
  const directiveHead = domainHash("compaction-directive-head", directives.map((item) => item.directiveId));
  const claimHead = domainHash("compaction-claim-head", claims.map((item) => item.claimId));
  const continuityHead = continuity.contentHash.length > 0
    ? continuity.contentHash
    : domainHash("compaction-continuity-head", { revisionId: continuity.revisionId, taskFronts: continuity.taskFronts });
  const catalogHead = domainHash("compaction-catalog-head", pointers.map((item) => ({ kind: item.kind, ref: item.ref })));
  const contextHead = domainHash("compaction-context-head", {
    cursor,
    directiveHead,
    claimHead,
    continuityHead,
    catalogHead,
  });
  return Object.freeze({ contextHead, directiveHead, claimHead, continuityHead, catalogHead });
}

export function assembleRuntimeSnapshot(rows: RuntimeSnapshotRows): RuntimeSnapshot {
  if (!rows || typeof rows !== "object") failInput("rows");
  const cursor = snapshotCursor(rows.cursor, "rows.cursor");
  if (!Array.isArray(rows.directives)) failInput("rows.directives");
  if (!Array.isArray(rows.claims)) failInput("rows.claims");
  if (!rows.continuity || typeof rows.continuity !== "object") failInput("rows.continuity");
  if (!Array.isArray(rows.pointers)) failInput("rows.pointers");
  if (!Array.isArray(rows.sourceEntryIds)) failInput("rows.sourceEntryIds");
  if (!sameCursor(cursor, snapshotCursor(rows.continuity.cursor, "rows.continuity.cursor"))) {
    throw new RuntimeSnapshotError("PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH");
  }
  const heads = deriveHeads(cursor, rows.directives, rows.continuity, rows.claims, rows.pointers);
  const configFingerprint = rows.configFingerprint
    ?? domainHash("runtime-snapshot-config", { schemaVersion: rows.schemaVersion, modelKey: cursor.modelKey });
  const sourceEntrySpan = {
    first: rows.sourceEntryIds[0] ?? "",
    last: rows.sourceEntryIds.at(-1) ?? "",
  };
  const snapshot: RuntimeSnapshot = {
    cursor,
    sourceEntrySpan,
    heads,
    activeDirectives: [...rows.directives],
    claims: [...rows.claims],
    continuity: rows.continuity,
    pointers: [...rows.pointers],
    schemaVersion: rows.schemaVersion,
    configFingerprint,
    snapshotHash: "",
  };
  snapshot.snapshotHash = domainHash("runtime-snapshot", {
    cursor,
    heads,
    sourceEntrySpan,
    schemaVersion: rows.schemaVersion,
    configFingerprint,
    directives: rows.directives.map((item) => item.directiveId),
    claims: rows.claims.map((item) => item.claimId),
    continuity: rows.continuity.contentHash,
    pointers: rows.pointers,
  });
  return Object.freeze(snapshot);
}

export function createRuntimeSnapshotTransaction(reader: RuntimeSnapshotReader): {
  assemble(cursor: RuntimeCursor, signal?: AbortSignal): Promise<RuntimeSnapshot>;
} {
  if (!reader || typeof reader.read !== "function") failMissing("reader.read");
  return {
    async assemble(cursorInput: RuntimeCursor, signal?: AbortSignal): Promise<RuntimeSnapshot> {
      if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
      signal?.throwIfAborted();
      const cursor = snapshotCursor(cursorInput);
      const rows = await reader.read(cursor, signal);
      signal?.throwIfAborted();
      if (!sameCursor(cursor, snapshotCursor(rows.cursor, "rows.cursor"))) {
        throw new RuntimeSnapshotError("PCR_RUNTIME_SNAPSHOT_SCOPE_MISMATCH");
      }
      return assembleRuntimeSnapshot(rows);
    },
  };
}
