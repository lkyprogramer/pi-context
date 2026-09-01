export type SeedMode = "provider-sampling" | "replicate-repeat";

export type CacheLane = "cold" | "hot";

export interface BoundReplicate {
  seed: number;
  seedMode: SeedMode;
  workspaceId: string;
  sessionId: string;
  sampling: { seed: number; temperature: number } | { seedUnsupported: true; replicateIndex: number };
}

export interface QueueEvent {
  arm: string;
  seed: number;
  enqueuedAt: number;
  startedAt: number;
  endedAt: number;
  rateLimited: boolean;
  rateLimitDelayMs: number;
}

export type ReplicatePolicyErrorCode =
  | "PCR_REPLICATE_INPUT_INVALID"
  | "PCR_REPLICATE_LABEL_ONLY"
  | "PCR_REPLICATE_CONCURRENT_ARMS"
  | "PCR_REPLICATE_CACHE_LANE_MIXED"
  | "PCR_REPLICATE_SCHEDULE_OVERLAP";

export class ReplicatePolicyError extends TypeError {
  readonly code: ReplicatePolicyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ReplicatePolicyErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ReplicatePolicyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export const DEFAULT_ARM_CONCURRENCY = 1 as const;

function fail(code: ReplicatePolicyErrorCode, details: Record<string, unknown> = {}): never {
  throw new ReplicatePolicyError(code, details);
}

function failInput(field: string): never {
  fail("PCR_REPLICATE_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function bindReplicate(input: {
  seed: number;
  workspaceId: string;
  sessionId: string;
  providerSupportsSeed: boolean;
  sampling?: { seed?: number; temperature?: number };
}): BoundReplicate {
  if (!input || typeof input !== "object") failInput("input");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) failInput("seed");
  requireNonEmpty(input.workspaceId, "workspaceId");
  requireNonEmpty(input.sessionId, "sessionId");
  if (typeof input.providerSupportsSeed !== "boolean") failInput("providerSupportsSeed");
  if (input.providerSupportsSeed) {
    if (input.sampling?.seed !== input.seed) {
      fail("PCR_REPLICATE_LABEL_ONLY", { seed: input.seed, samplingSeed: input.sampling?.seed ?? null });
    }
    return Object.freeze({
      seed: input.seed,
      seedMode: "provider-sampling",
      workspaceId: input.workspaceId,
      sessionId: input.sessionId,
      sampling: Object.freeze({
        seed: input.seed,
        temperature: typeof input.sampling.temperature === "number" ? input.sampling.temperature : 0,
      }),
    });
  }
  if (input.sampling?.seed !== undefined && input.sampling.seed !== input.seed) failInput("sampling.seed");
  return Object.freeze({
    seed: input.seed,
    seedMode: "replicate-repeat",
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
    sampling: Object.freeze({ seedUnsupported: true, replicateIndex: input.seed }),
  });
}

export function rejectLabelOnlySeed(input: {
  seed: number;
  label?: string;
  sampling?: { seed?: number; seedUnsupported?: boolean };
  workspaceId?: string;
  sessionId?: string;
}): void {
  if (!input || typeof input !== "object") failInput("input");
  if (!Number.isSafeInteger(input.seed) || input.seed < 0) failInput("seed");
  const samplingBound = input.sampling?.seed === input.seed || input.sampling?.seedUnsupported === true;
  if (!input.workspaceId || !input.sessionId || !samplingBound) {
    fail("PCR_REPLICATE_LABEL_ONLY", { seed: input.seed, label: input.label ?? null });
  }
}

export function latinSquareOrder<T>(arms: readonly T[], replicateIndex: number): T[] {
  if (!Array.isArray(arms) || arms.length === 0) failInput("arms");
  if (!Number.isSafeInteger(replicateIndex) || replicateIndex < 0) failInput("replicateIndex");
  const offset = replicateIndex % arms.length;
  return arms.map((_, index) => arms[(index + offset) % arms.length]!);
}

export function assertSerialArms(runningCount: number): void {
  if (!Number.isSafeInteger(runningCount) || runningCount < 0) failInput("runningCount");
  if (runningCount > DEFAULT_ARM_CONCURRENCY) {
    fail("PCR_REPLICATE_CONCURRENT_ARMS", { runningCount, max: DEFAULT_ARM_CONCURRENCY });
  }
}

export function partitionCacheLanes<T extends { cacheLane: CacheLane }>(rows: readonly T[]): { cold: T[]; hot: T[] } {
  if (!Array.isArray(rows)) failInput("rows");
  const cold: T[] = [];
  const hot: T[] = [];
  for (const row of rows) {
    if (!row || (row.cacheLane !== "cold" && row.cacheLane !== "hot")) failInput("cacheLane");
    if (row.cacheLane === "cold") cold.push(row);
    else hot.push(row);
  }
  return { cold, hot };
}

export function assertSeparateCacheLanes(
  cold: readonly { requestId: string }[],
  hot: readonly { requestId: string }[],
): void {
  if (!Array.isArray(cold) || !Array.isArray(hot)) failInput("lanes");
  const coldIds = new Set<string>();
  for (const row of cold) {
    requireNonEmpty(row?.requestId, "cold.requestId");
    coldIds.add(row.requestId);
  }
  for (const row of hot) {
    requireNonEmpty(row?.requestId, "hot.requestId");
    if (coldIds.has(row.requestId)) fail("PCR_REPLICATE_CACHE_LANE_MIXED", { requestId: row.requestId });
  }
}

export function recordSchedule(events: readonly QueueEvent[]): {
  serial: true;
  maxConcurrent: 1;
  rateLimited: number;
  queue: readonly QueueEvent[];
} {
  if (!Array.isArray(events) || events.length === 0) failInput("events");
  const ordered = [...events].sort((left, right) => left.startedAt - right.startedAt || left.enqueuedAt - right.enqueuedAt);
  for (let index = 0; index < ordered.length; index += 1) {
    const row = ordered[index]!;
    if (!Number.isFinite(row.enqueuedAt) || !Number.isFinite(row.startedAt) || !Number.isFinite(row.endedAt)) {
      failInput("events.times");
    }
    if (row.endedAt < row.startedAt) failInput("events.endedAt");
    if (typeof row.rateLimited !== "boolean") failInput("events.rateLimited");
    if (!Number.isFinite(row.rateLimitDelayMs) || row.rateLimitDelayMs < 0) failInput("events.rateLimitDelayMs");
    if (index > 0) {
      const prev = ordered[index - 1]!;
      if (row.startedAt < prev.endedAt) {
        fail("PCR_REPLICATE_SCHEDULE_OVERLAP", { prev: prev.arm, next: row.arm });
      }
    }
  }
  return Object.freeze({
    serial: true,
    maxConcurrent: 1,
    rateLimited: ordered.filter((row) => row.rateLimited).length,
    queue: Object.freeze(ordered.map((row) => Object.freeze({ ...row }))),
  });
}
