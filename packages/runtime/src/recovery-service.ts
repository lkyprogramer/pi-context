import type { RuntimeCursor } from "@pcr/contracts";

import type { RuntimeSession } from "./ports.js";
import type { HostSnapshot, RecoveryAction, RecoveryReport as SagaRecoveryReport } from "./saga/contracts.js";
import type { PiSessionContext } from "./session-registry.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASONS = new Set(["new", "resume", "fork", "reload"]);

export type SessionStartReason = "new" | "resume" | "fork" | "reload";

export interface CatchUpResult {
  reason: SessionStartReason;
  degraded: boolean;
  pointerUnavailable: boolean;
}

export interface SessionStart {
  cursor: RuntimeCursor;
  reason: SessionStartReason;
  hasRawBlobs: boolean;
  hostSnapshot?: HostSnapshot;
  signal?: AbortSignal;
}

export interface BranchChange {
  cursor: RuntimeCursor;
  previousCursor: RuntimeCursor;
  newLeafId: string;
  signal?: AbortSignal;
}

export interface SessionRecoveryReport {
  cursor: RuntimeCursor;
  catchUp: CatchUpResult;
  saga: SagaRecoveryReport;
  candidatesInvalidated: number;
}

export interface RecoveryService {
  onSessionStart(input: SessionStart): Promise<SessionRecoveryReport>;
  onBranchChange(input: BranchChange): Promise<void>;
  onSessionClose(input: { cursor: RuntimeCursor; signal?: AbortSignal }): Promise<void>;
}

export interface RecoverySessionPort {
  open(ctx: PiSessionContext): Promise<RuntimeSession | unknown>;
  close(sessionId: string): Promise<void>;
}

export interface RecoveryJournalPort {
  reconcile(snapshot: HostSnapshot): Promise<SagaRecoveryReport>;
}

export interface CandidateFence {
  invalidate(cursor: RuntimeCursor, reason: string, signal?: AbortSignal): Promise<number>;
}

export interface CreateRecoveryServiceInput {
  cursor: RuntimeCursor;
  sessions: RecoverySessionPort;
  journal: RecoveryJournalPort;
  candidates: CandidateFence;
}

export type RecoveryServiceErrorCode =
  | "PCR_RECOVERY_DEPENDENCY_MISSING"
  | "PCR_RECOVERY_INPUT_INVALID"
  | "PCR_RECOVERY_SCOPE_MISMATCH";

export class RecoveryServiceError extends TypeError {
  readonly code: RecoveryServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RecoveryServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RecoveryServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new RecoveryServiceError("PCR_RECOVERY_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new RecoveryServiceError("PCR_RECOVERY_INPUT_INVALID", { field });
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

function sameWorkspace(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId;
}

function requireFunction(value: unknown, dependency: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") failMissing(dependency);
}

function catchUpSession(reason: SessionStartReason, hasRawBlobs: boolean): CatchUpResult {
  const pointerUnavailable = reason !== "new" && !hasRawBlobs;
  return Object.freeze({ reason, degraded: pointerUnavailable, pointerUnavailable });
}

function asSessionContext(cursor: RuntimeCursor, signal?: AbortSignal): PiSessionContext {
  return {
    workspaceId: cursor.workspaceId,
    sessionId: cursor.sessionId,
    leafId: cursor.leafId,
    lineageHash: cursor.lineageHash,
    modelKey: cursor.modelKey,
    signal,
  };
}

export function createRecoveryService(input: CreateRecoveryServiceInput): RecoveryService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.sessions || typeof input.sessions !== "object") failMissing("sessions");
  requireFunction(input.sessions.open, "sessions.open");
  requireFunction(input.sessions.close, "sessions.close");
  if (!input.journal || typeof input.journal !== "object") failMissing("journal");
  requireFunction(input.journal.reconcile, "journal.reconcile");
  if (!input.candidates || typeof input.candidates !== "object") failMissing("candidates");
  requireFunction(input.candidates.invalidate, "candidates.invalidate");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const sessions = input.sessions;
  const journal = input.journal;
  const candidates = input.candidates;

  return {
    async onSessionStart(request: SessionStart): Promise<SessionRecoveryReport> {
      if (!request || typeof request !== "object") failInput("request");
      if (typeof request.reason !== "string" || !REASONS.has(request.reason)) failInput("request.reason");
      if (typeof request.hasRawBlobs !== "boolean") failInput("request.hasRawBlobs");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      if (request.hostSnapshot !== undefined && (!request.hostSnapshot || typeof request.hostSnapshot !== "object")) {
        failInput("request.hostSnapshot");
      }
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameWorkspace(bound, cursor)) throw new RecoveryServiceError("PCR_RECOVERY_SCOPE_MISMATCH");
      request.signal?.throwIfAborted();
      await sessions.open(asSessionContext(cursor, request.signal));
      request.signal?.throwIfAborted();
      const saga = request.hostSnapshot
        ? await journal.reconcile(request.hostSnapshot)
        : { actions: [] };
      request.signal?.throwIfAborted();
      const candidatesInvalidated = await candidates.invalidate(cursor, `session-start:${request.reason}`, request.signal);
      const actions: RecoveryAction[] = [...(saga.actions ?? [])];
      return {
        cursor,
        catchUp: catchUpSession(request.reason, request.hasRawBlobs),
        saga: { actions },
        candidatesInvalidated,
      };
    },
    async onBranchChange(request: BranchChange): Promise<void> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.newLeafId, "request.newLeafId");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      const previous = snapshotCursor(request.previousCursor, "request.previousCursor");
      if (!sameWorkspace(bound, cursor) || !sameWorkspace(bound, previous)) {
        throw new RecoveryServiceError("PCR_RECOVERY_SCOPE_MISMATCH");
      }
      request.signal?.throwIfAborted();
      await sessions.close(previous.sessionId);
      request.signal?.throwIfAborted();
      await sessions.open(asSessionContext(cursor, request.signal));
      request.signal?.throwIfAborted();
      await candidates.invalidate(previous, `branch-change:${request.newLeafId}`, request.signal);
      await candidates.invalidate(cursor, `branch-change:${request.newLeafId}`, request.signal);
    },
    async onSessionClose(request: { cursor: RuntimeCursor; signal?: AbortSignal }): Promise<void> {
      if (!request || typeof request !== "object") failInput("request");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameWorkspace(bound, cursor)) throw new RecoveryServiceError("PCR_RECOVERY_SCOPE_MISMATCH");
      request.signal?.throwIfAborted();
      await sessions.close(cursor.sessionId);
    },
  };
}
