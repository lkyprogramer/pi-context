import { domainHash, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import type { ContinuityRevision } from "@pcr/core";

import { buildFullCheckpointState } from "./full-state.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASONS = new Set(["threshold", "overflow", "manual"]);

export interface CompactionClaim {
  claimId: string;
  key: string;
  polarity: string;
  status: string;
  value: unknown;
}

export interface CompactionPointer {
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

export interface CompactionRequest {
  operationId: string;
  cursor: RuntimeCursor;
  reason: "threshold" | "overflow" | "manual";
  now: number;
  signal?: AbortSignal;
}

export interface CompactionSnapshot {
  snapshotHash: string;
  cursor: RuntimeCursor;
  assembledAt: number;
  reason: CompactionRequest["reason"];
  directives: readonly DirectiveRecord[];
  continuity: ContinuityRevision;
  claims: readonly CompactionClaim[];
  pointers: readonly CompactionPointer[];
  heads: CompactionSnapshotHeads;
  errors: readonly string[];
  validation: ReadonlyArray<{ id: string; status: string }>;
  sideEffects: readonly string[];
  nextSafeActions: ReadonlyArray<{ text: string }>;
  taskFronts: ContinuityRevision["taskFronts"];
}

export interface CompactionSnapshotTransaction {
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export interface CompactionDirectiveSource {
  active(cursor: RuntimeCursor, signal?: AbortSignal): Promise<readonly DirectiveRecord[]>;
}

export interface CompactionContinuitySource {
  current(cursor: RuntimeCursor): Promise<ContinuityRevision>;
}

export interface CompactionClaimSource {
  list(cursor: RuntimeCursor, signal?: AbortSignal): Promise<readonly CompactionClaim[]>;
}

export interface CompactionEvidenceSource {
  pointers(cursor: RuntimeCursor, signal?: AbortSignal): Promise<readonly CompactionPointer[]>;
}

export interface CompactionSnapshotAssembler {
  assemble(input: CompactionRequest): Promise<CompactionSnapshot>;
}

export interface CreateCompactionSnapshotAssemblerInput {
  cursor: RuntimeCursor;
  transaction: CompactionSnapshotTransaction;
  directives: CompactionDirectiveSource;
  continuity: CompactionContinuitySource;
  claims: CompactionClaimSource;
  evidence: CompactionEvidenceSource;
}

export type CompactionSnapshotErrorCode =
  | "PCR_COMPACTION_SNAPSHOT_DEPENDENCY_MISSING"
  | "PCR_COMPACTION_SNAPSHOT_INPUT_INVALID"
  | "PCR_COMPACTION_SNAPSHOT_SCOPE_MISMATCH";

export class CompactionSnapshotError extends TypeError {
  readonly code: CompactionSnapshotErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CompactionSnapshotErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CompactionSnapshotError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CompactionSnapshotError("PCR_COMPACTION_SNAPSHOT_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CompactionSnapshotError("PCR_COMPACTION_SNAPSHOT_INPUT_INVALID", { field });
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

function freezeDirectives(value: unknown, field: string): readonly DirectiveRecord[] {
  if (!Array.isArray(value)) failInput(field);
  return Object.freeze(value.map((item, index) => {
    if (!item || typeof item !== "object") failInput(`${field}[${index}]`);
    const record = item as DirectiveRecord;
    requireNonEmpty(record.directiveId, `${field}[${index}].directiveId`);
    return Object.freeze({ ...record });
  }));
}

function freezeClaims(value: unknown, field: string): readonly CompactionClaim[] {
  if (!Array.isArray(value)) failInput(field);
  return Object.freeze(value.map((item, index) => {
    if (!item || typeof item !== "object") failInput(`${field}[${index}]`);
    const claim = item as CompactionClaim;
    requireNonEmpty(claim.claimId, `${field}[${index}].claimId`);
    requireNonEmpty(claim.key, `${field}[${index}].key`);
    requireNonEmpty(claim.polarity, `${field}[${index}].polarity`);
    requireNonEmpty(claim.status, `${field}[${index}].status`);
    return Object.freeze({
      claimId: claim.claimId,
      key: claim.key,
      polarity: claim.polarity,
      status: claim.status,
      value: claim.value,
    });
  }));
}

function freezePointers(value: unknown, field: string): readonly CompactionPointer[] {
  if (!Array.isArray(value)) failInput(field);
  return Object.freeze(value.map((item, index) => {
    if (!item || typeof item !== "object") failInput(`${field}[${index}]`);
    const pointer = item as CompactionPointer;
    requireNonEmpty(pointer.ref, `${field}[${index}].ref`);
    requireNonEmpty(pointer.kind, `${field}[${index}].kind`);
    return Object.freeze({ ref: pointer.ref, kind: pointer.kind });
  }));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function extractErrors(value: unknown): string[] {
  const errors = asRecord(value).unresolvedErrors;
  if (!Array.isArray(errors)) return [];
  return errors.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string") {
      return (item as { message: string }).message;
    }
    return JSON.stringify(item);
  });
}

function extractSideEffects(value: unknown): string[] {
  const effects = asRecord(value).externalSideEffects;
  if (!Array.isArray(effects)) return [];
  return effects.map((item) => {
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const record = item as { id?: unknown; kind?: unknown; status?: unknown };
      return [record.kind, record.status, record.id].filter((part) => typeof part === "string").join(":");
    }
    return JSON.stringify(item);
  });
}

function extractValidation(value: unknown): Array<{ id: string; status: string }> {
  const rows = asRecord(value).validationState;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as { id?: unknown; status?: unknown };
    if (typeof record.id !== "string" || typeof record.status !== "string") return [];
    return [{ id: record.id, status: record.status }];
  });
}

function freezeContinuity(value: unknown, cursor: RuntimeCursor, field: string): ContinuityRevision {
  if (!value || typeof value !== "object") failInput(field);
  const revision = value as ContinuityRevision;
  if (typeof revision.revisionId !== "string") failInput(`${field}.revisionId`);
  if (!revision.taskFronts || typeof revision.taskFronts !== "object") failInput(`${field}.taskFronts`);
  return Object.freeze({
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId ?? null,
    contentHash: revision.contentHash,
    cursor: snapshotCursor(cursor, `${field}.cursor`),
    taskFronts: Object.freeze({
      active: [...(revision.taskFronts.active ?? [])],
      parked: [...(revision.taskFronts.parked ?? [])],
      completed: [...(revision.taskFronts.completed ?? [])],
      superseded: [...(revision.taskFronts.superseded ?? [])],
    }),
    nextSafeActions: Object.freeze([...(revision.nextSafeActions ?? [])]),
  }) as ContinuityRevision;
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

export function createCompactionSnapshotAssembler(
  input: CreateCompactionSnapshotAssemblerInput,
): CompactionSnapshotAssembler {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  if (!input.transaction || typeof input.transaction !== "object") failMissing("transaction");
  requireFunction(input.transaction.run, "transaction.run");
  if (!input.directives || typeof input.directives !== "object") failMissing("directives");
  requireFunction(input.directives.active, "directives.active");
  if (!input.continuity || typeof input.continuity !== "object") failMissing("continuity");
  requireFunction(input.continuity.current, "continuity.current");
  if (!input.claims || typeof input.claims !== "object") failMissing("claims");
  requireFunction(input.claims.list, "claims.list");
  if (!input.evidence || typeof input.evidence !== "object") failMissing("evidence");
  requireFunction(input.evidence.pointers, "evidence.pointers");
  const transaction = input.transaction;
  const directives = input.directives;
  const continuity = input.continuity;
  const claims = input.claims;
  const evidence = input.evidence;

  return {
    async assemble(request: CompactionRequest): Promise<CompactionSnapshot> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.operationId, "request.operationId");
      if (typeof request.reason !== "string" || !REASONS.has(request.reason)) failInput("request.reason");
      if (typeof request.now !== "number" || !Number.isFinite(request.now)) failInput("request.now");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) {
        throw new CompactionSnapshotError("PCR_COMPACTION_SNAPSHOT_SCOPE_MISMATCH");
      }
      request.signal?.throwIfAborted();
      const assembled = await transaction.run(async () => {
        request.signal?.throwIfAborted();
        const active = freezeDirectives(await directives.active(cursor, request.signal), "directives");
        request.signal?.throwIfAborted();
        const rawContinuity = await continuity.current(cursor);
        const revision = freezeContinuity(rawContinuity, cursor, "continuity");
        request.signal?.throwIfAborted();
        const listed = freezeClaims(await claims.list(cursor, request.signal), "claims");
        request.signal?.throwIfAborted();
        const pointers = freezePointers(await evidence.pointers(cursor, request.signal), "pointers");
        return {
          active,
          revision,
          listed,
          pointers,
          errors: extractErrors(rawContinuity),
          validation: extractValidation(rawContinuity),
          sideEffects: extractSideEffects(rawContinuity),
        };
      }, request.signal);
      request.signal?.throwIfAborted();
      const full = buildFullCheckpointState(cursor, {
        directives: assembled.active,
        claims: assembled.listed,
        taskFronts: assembled.revision.taskFronts,
        errors: assembled.errors,
        validation: assembled.validation,
        nextSafeActions: assembled.revision.nextSafeActions,
        sideEffects: assembled.sideEffects,
      });
      const heads = deriveHeads(cursor, assembled.active, assembled.revision, assembled.listed, assembled.pointers);
      const payload = {
        cursor,
        assembledAt: request.now,
        reason: request.reason,
        directives: assembled.active,
        continuity: assembled.revision,
        claims: assembled.listed,
        pointers: assembled.pointers,
        heads,
      };
      return Object.freeze({
        snapshotHash: domainHash("compaction-snapshot", payload),
        ...payload,
        errors: full.errors,
        validation: full.validation,
        sideEffects: full.sideEffects,
        nextSafeActions: full.nextSafeActions,
        taskFronts: full.taskFronts,
      });
    },
  };
}
