import { estimateTextTokens, type CheckpointRenderer, type CheckpointVerifier } from "@pcr/core";
import type { HostCheckpointDetails, RuntimeCursor } from "@pcr/contracts";

import type { CompactionSnapshotAssembler } from "./compaction/snapshot.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const REASONS = new Set(["threshold", "overflow", "manual"]);

export interface CompactionPrepareRequest {
  operationId: string;
  cursor: RuntimeCursor;
  reason: "threshold" | "overflow" | "manual";
  now: number;
  tokensBefore: number;
  firstKeptEntryId: string;
  signal?: AbortSignal;
}

export interface CompactionReadyResult {
  firstKeptEntryId: string;
  summary: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  details: HostCheckpointDetails;
}

export type CompactionDecision =
  | { kind: "pcr"; result: CompactionReadyResult }
  | { kind: "native-fallback" }
  | { kind: "hard-stop"; code: string };

export interface CompactionService {
  prepareCompaction(input: CompactionPrepareRequest): Promise<CompactionDecision>;
}

export interface CreateCompactionServiceInput {
  cursor: RuntimeCursor;
  assembler: CompactionSnapshotAssembler;
  renderer: CheckpointRenderer;
  verifier: CheckpointVerifier;
}

export type CompactionServiceErrorCode =
  | "PCR_COMPACTION_DEPENDENCY_MISSING"
  | "PCR_COMPACTION_INPUT_INVALID"
  | "PCR_COMPACTION_SCOPE_MISMATCH";

export class CompactionServiceError extends TypeError {
  readonly code: CompactionServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CompactionServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CompactionServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CompactionServiceError("PCR_COMPACTION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CompactionServiceError("PCR_COMPACTION_INPUT_INVALID", { field });
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

function mapAssemblerError(error: unknown): never {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code.endsWith("SCOPE_MISMATCH")) {
      throw new CompactionServiceError("PCR_COMPACTION_SCOPE_MISMATCH");
    }
    if (error.code.endsWith("INPUT_INVALID")) {
      throw new CompactionServiceError("PCR_COMPACTION_INPUT_INVALID", { field: error.code });
    }
  }
  throw error;
}

function renderSummary(checkpoint: {
  snapshotHash: string;
  directives: ReadonlyArray<{
    directiveId: string;
    exactQuote: string;
    kind: string;
    polarity: string;
    status: string;
  }>;
  claims: ReadonlyArray<{ claimId: string; key: string; polarity: string; status: string; value: unknown }>;
  pointers: ReadonlyArray<{ ref: string; kind: string }>;
  heads: Record<string, string>;
  continuity: { revisionId: string; contentHash?: string };
}): string {
  return [
    `checkpoint v2 ${checkpoint.snapshotHash}`,
    ...checkpoint.directives.map((item) =>
      `- [${item.directiveId}] ${item.exactQuote} kind=${item.kind} polarity=${item.polarity} status=${item.status}`
    ),
    `continuity ${checkpoint.continuity.revisionId}`,
    ...checkpoint.claims.map((item) =>
      `- [${item.claimId}] ${item.key} polarity=${item.polarity} status=${item.status} value=${String(item.value)}`
    ),
    ...checkpoint.pointers.map((item) => `- ${item.kind}:${item.ref}`),
    `heads ${checkpoint.heads.directiveHead} ${checkpoint.heads.claimHead} ${checkpoint.heads.continuityHead}`,
  ].join("\n");
}

export function createCompactionService(input: CreateCompactionServiceInput): CompactionService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.assembler || typeof input.assembler !== "object") failMissing("assembler");
  requireFunction(input.assembler.assemble, "assembler.assemble");
  if (!input.renderer || typeof input.renderer !== "object") failMissing("renderer");
  requireFunction(input.renderer.render, "renderer.render");
  if (!input.verifier || typeof input.verifier !== "object") failMissing("verifier");
  requireFunction(input.verifier.verify, "verifier.verify");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const assembler = input.assembler;
  const renderer = input.renderer;
  const verifier = input.verifier;

  return {
    async prepareCompaction(request: CompactionPrepareRequest): Promise<CompactionDecision> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.operationId, "request.operationId");
      requireNonEmpty(request.firstKeptEntryId, "request.firstKeptEntryId");
      if (typeof request.reason !== "string" || !REASONS.has(request.reason)) failInput("request.reason");
      if (typeof request.now !== "number" || !Number.isFinite(request.now)) failInput("request.now");
      if (typeof request.tokensBefore !== "number" || !Number.isFinite(request.tokensBefore) || request.tokensBefore < 0) {
        failInput("request.tokensBefore");
      }
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) throw new CompactionServiceError("PCR_COMPACTION_SCOPE_MISMATCH");
      request.signal?.throwIfAborted();
      let snapshot;
      try {
        snapshot = await assembler.assemble({
          operationId: request.operationId,
          cursor,
          reason: request.reason,
          now: request.now,
          signal: request.signal,
        });
      } catch (error) {
        mapAssemblerError(error);
      }
      request.signal?.throwIfAborted();
      const checkpoint = await renderer.render(snapshot, request.signal);
      const report = await verifier.verify(snapshot, checkpoint, request.signal);
      if (!report.ok) {
        return { kind: "hard-stop", code: report.issues[0]?.code ?? "PCR_CHECKPOINT_VERIFY_FAILED" };
      }
      const summary = renderSummary({
        snapshotHash: checkpoint.snapshotHash,
        directives: checkpoint.directives,
        claims: checkpoint.claims as Array<{ claimId: string; key: string; polarity: string; status: string; value: unknown }>,
        pointers: checkpoint.pointers as Array<{ ref: string; kind: string }>,
        heads: checkpoint.heads as Record<string, string>,
        continuity: checkpoint.continuity as { revisionId: string; contentHash?: string },
      });
      const estimatedTokensAfter = estimateTextTokens(summary);
      if (!(estimatedTokensAfter < request.tokensBefore)) return { kind: "native-fallback" };
      return {
        kind: "pcr",
        result: {
          firstKeptEntryId: request.firstKeptEntryId,
          summary,
          tokensBefore: request.tokensBefore,
          estimatedTokensAfter,
          details: {
            schemaVersion: 1,
            directiveHead: snapshot.heads.directiveHead,
            claimHead: snapshot.heads.claimHead,
            continuityHead: snapshot.heads.continuityHead,
            catalogHead: snapshot.heads.catalogHead,
            outputHash: report.outputHash,
            reducerRevisions: [],
          },
        },
      };
    },
  };
}
