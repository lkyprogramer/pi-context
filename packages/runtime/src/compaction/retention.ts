import type { RuntimeCursor } from "@pcr/contracts";

import type { CompactionPrepareRequest, CompactionService } from "../compaction-service.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MIN_CYCLES = 3;

export interface BoundednessReport {
  cycles: number;
  maxActiveTokens: number;
  growthSlope: number;
  passed: boolean;
}

export interface RetentionRunInput {
  seed: CompactionPrepareRequest;
  cycles?: number;
}

export interface RetentionController {
  run(input: RetentionRunInput): Promise<BoundednessReport>;
}

export interface CreateRetentionControllerInput {
  cursor: RuntimeCursor;
  compaction: Pick<CompactionService, "prepareCompaction">;
  budgetTokens: number;
  inboundTokensPerCycle: number;
}

export type RetentionControllerErrorCode =
  | "PCR_RETENTION_DEPENDENCY_MISSING"
  | "PCR_RETENTION_INPUT_INVALID"
  | "PCR_RETENTION_SCOPE_MISMATCH";

export class RetentionControllerError extends TypeError {
  readonly code: RetentionControllerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: RetentionControllerErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "RetentionControllerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new RetentionControllerError("PCR_RETENTION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new RetentionControllerError("PCR_RETENTION_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFunction(value: unknown, dependency: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") failMissing(dependency);
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

function requirePositive(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) failInput(field);
  return value;
}

function requireNonNegative(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) failInput(field);
  return value;
}

function retainActiveTokens(summaryTokens: number, inboundTokens: number, budgetTokens: number): number {
  const room = Math.max(0, budgetTokens - summaryTokens);
  return summaryTokens + Math.min(inboundTokens, room);
}

function growthSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - xMean;
    numerator += dx * (values[index] - yMean);
    denominator += dx * dx;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function freezeReport(report: BoundednessReport): BoundednessReport {
  return Object.freeze({ ...report });
}

function reportFrom(series: readonly number[], completed: number, budgetTokens: number): BoundednessReport {
  const maxActiveTokens = series.length === 0 ? 0 : Math.max(...series);
  const slope = growthSlope(series);
  return freezeReport({
    cycles: completed,
    maxActiveTokens,
    growthSlope: slope,
    passed: completed >= MIN_CYCLES && maxActiveTokens <= budgetTokens && slope <= 0,
  });
}

function mapCompactError(error: unknown): never {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code.endsWith("SCOPE_MISMATCH")) {
      throw new RetentionControllerError("PCR_RETENTION_SCOPE_MISMATCH");
    }
    if (error.code.endsWith("INPUT_INVALID")) {
      throw new RetentionControllerError("PCR_RETENTION_INPUT_INVALID", { field: error.code });
    }
  }
  throw error;
}

export function createRetentionController(input: CreateRetentionControllerInput): RetentionController {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.compaction || typeof input.compaction !== "object") failMissing("compaction");
  requireFunction(input.compaction.prepareCompaction, "compaction.prepareCompaction");
  const budgetTokens = requirePositive(input.budgetTokens, "budgetTokens");
  const inboundTokensPerCycle = requireNonNegative(input.inboundTokensPerCycle, "inboundTokensPerCycle");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const compaction = input.compaction;

  return {
    async run(request: RetentionRunInput): Promise<BoundednessReport> {
      if (!request || typeof request !== "object") failInput("request");
      if (!request.seed || typeof request.seed !== "object") failInput("request.seed");
      const cycles = request.cycles === undefined ? MIN_CYCLES : request.cycles;
      if (!Number.isInteger(cycles) || cycles < MIN_CYCLES) failInput("request.cycles");
      const seed = request.seed;
      if (seed.signal !== undefined && !(seed.signal instanceof AbortSignal)) failInput("request.seed.signal");
      seed.signal?.throwIfAborted();
      const cursor = snapshotCursor(seed.cursor, "request.seed.cursor");
      if (!sameCursor(bound, cursor)) throw new RetentionControllerError("PCR_RETENTION_SCOPE_MISMATCH");
      const series: number[] = [];
      let tokensBefore = seed.tokensBefore;
      for (let cycle = 0; cycle < cycles; cycle += 1) {
        seed.signal?.throwIfAborted();
        let decision;
        try {
          decision = await compaction.prepareCompaction({
            ...seed,
            cursor,
            operationId: `${seed.operationId}:${cycle}`,
            tokensBefore,
          });
        } catch (error) {
          mapCompactError(error);
        }
        if (decision.kind !== "pcr") {
          return reportFrom(series, series.length, budgetTokens);
        }
        const active = retainActiveTokens(
          decision.result.estimatedTokensAfter,
          inboundTokensPerCycle,
          budgetTokens,
        );
        series.push(active);
        tokensBefore = active;
      }
      return reportFrom(series, series.length, budgetTokens);
    },
  };
}
