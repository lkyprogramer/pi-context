export interface PerformanceReport {
  hookP50Ms: number;
  hookP95Ms: number;
  cacheEligibleRatio: number;
  cacheReadTokens: number;
  cloneBytes: number;
}

export type PerformanceLane = "boundary-replay" | "natural-threshold" | "provider-overflow";

export type CompactReason = "threshold" | "overflow" | "replay";

export interface RouteWindow {
  modelKey: string;
  contextWindow: number;
  maxOutputTokens: number;
  providerReservedTokens: number;
}

export interface PerformanceCache {
  current(scope: { workspaceId: string; sessionId: string }, signal?: AbortSignal): Promise<{ eligiblePrefixTokens: number } | null>;
}

export interface PerformanceClone {
  measure(scope: { workspaceId: string; sessionId: string }, signal?: AbortSignal): Promise<number>;
}

export interface PerformanceLaneSample {
  lane: PerformanceLane;
  workspaceId: string;
  sessionId: string;
  modelKey: string;
  tokensBefore: number;
  tokensAfter: number;
  compactReason: CompactReason;
  promptTokens: number;
  hookMs: readonly number[];
  keepRecent?: number;
  signal?: AbortSignal;
}

export interface PerformanceLaneRunner {
  measure(sample: PerformanceLaneSample): Promise<PerformanceReport>;
}

export interface CreatePerformanceLaneRunnerInput {
  workspaceId: string;
  routes: Readonly<Record<string, RouteWindow>>;
  cache: PerformanceCache;
  clone: PerformanceClone;
}

export type PerformanceErrorCode =
  | "PCR_PERFORMANCE_DEPENDENCY_MISSING"
  | "PCR_PERFORMANCE_INPUT_INVALID"
  | "PCR_PERFORMANCE_SCOPE_MISMATCH";

export class PerformanceLaneError extends TypeError {
  readonly code: PerformanceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: PerformanceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "PerformanceLaneError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const LANES = new Set<PerformanceLane>(["boundary-replay", "natural-threshold", "provider-overflow"]);
const REASONS = new Set<CompactReason>(["threshold", "overflow", "replay"]);

function failMissing(dependency: string): never {
  throw new PerformanceLaneError("PCR_PERFORMANCE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new PerformanceLaneError("PCR_PERFORMANCE_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new PerformanceLaneError("PCR_PERFORMANCE_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireCount(value: unknown, field: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) failInput(field);
}

function percentile(values: readonly number[], p: number): number {
  const xs = [...values].sort((left, right) => left - right);
  const pos = (xs.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return xs[lo] ?? 0;
  return (xs[lo] ?? 0) * (hi - pos) + (xs[hi] ?? 0) * (pos - lo);
}

function snapshotRoutes(routes: CreatePerformanceLaneRunnerInput["routes"]): Readonly<Record<string, RouteWindow>> {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) failMissing("routes");
  const next: Record<string, RouteWindow> = {};
  for (const [key, route] of Object.entries(routes)) {
    requireNonEmpty(key, "routes[]");
    if (!route || typeof route !== "object") failInput(`routes.${key}`);
    requireNonEmpty(route.modelKey, `routes.${key}.modelKey`);
    if (route.modelKey !== key) failInput(`routes.${key}.modelKey`);
    requireCount(route.contextWindow, `routes.${key}.contextWindow`);
    requireCount(route.maxOutputTokens, `routes.${key}.maxOutputTokens`);
    requireCount(route.providerReservedTokens, `routes.${key}.providerReservedTokens`);
    if (route.contextWindow < 1) failInput(`routes.${key}.contextWindow`);
    const effective = route.contextWindow - route.maxOutputTokens - route.providerReservedTokens;
    if (!Number.isSafeInteger(effective) || effective < 1) failInput(`routes.${key}`);
    next[key] = {
      modelKey: route.modelKey,
      contextWindow: route.contextWindow,
      maxOutputTokens: route.maxOutputTokens,
      providerReservedTokens: route.providerReservedTokens,
    };
  }
  if (Object.keys(next).length === 0) failMissing("routes");
  return Object.freeze(next);
}

function effectiveInput(route: RouteWindow): number {
  return route.contextWindow - route.maxOutputTokens - route.providerReservedTokens;
}

function assertLane(sample: PerformanceLaneSample, route: RouteWindow): void {
  if (!LANES.has(sample.lane)) failInput("lane");
  if (!REASONS.has(sample.compactReason)) failInput("compactReason");
  if (sample.keepRecent !== undefined) {
    requireCount(sample.keepRecent, "keepRecent");
    if (sample.lane !== "boundary-replay") failInput("keepRecent");
  }
  if (sample.lane === "boundary-replay") {
    if (sample.compactReason !== "replay") failInput("lane");
    return;
  }
  if (sample.lane === "natural-threshold") {
    if (sample.compactReason !== "threshold") failInput("lane");
    if (sample.tokensBefore < effectiveInput(route)) failInput("tokensBefore");
    return;
  }
  if (sample.compactReason !== "overflow") failInput("lane");
  if (sample.tokensBefore <= route.contextWindow) failInput("tokensBefore");
}

export function createPerformanceLaneRunner(input: CreatePerformanceLaneRunnerInput): PerformanceLaneRunner {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.workspaceId !== "string" || input.workspaceId.length === 0) failMissing("workspaceId");
  if (!input.cache || typeof input.cache.current !== "function") failMissing("cache");
  if (!input.clone || typeof input.clone.measure !== "function") failMissing("clone");
  const routes = snapshotRoutes(input.routes);
  const workspaceId = input.workspaceId;
  const cache = input.cache;
  const clone = input.clone;
  return {
    async measure(sample: PerformanceLaneSample): Promise<PerformanceReport> {
      if (!sample || typeof sample !== "object") failInput("sample");
      if (sample.signal !== undefined && !(sample.signal instanceof AbortSignal)) failInput("signal");
      sample.signal?.throwIfAborted();
      requireNonEmpty(sample.workspaceId, "workspaceId");
      requireNonEmpty(sample.sessionId, "sessionId");
      requireNonEmpty(sample.modelKey, "modelKey");
      if (sample.workspaceId !== workspaceId) failScope({ workspaceId: sample.workspaceId });
      const route = routes[sample.modelKey];
      if (!route) failInput("modelKey");
      requireCount(sample.tokensBefore, "tokensBefore");
      requireCount(sample.tokensAfter, "tokensAfter");
      requireCount(sample.promptTokens, "promptTokens");
      if (sample.promptTokens < 1) failInput("promptTokens");
      if (!Array.isArray(sample.hookMs) || sample.hookMs.length === 0) failInput("hookMs");
      for (const [index, item] of sample.hookMs.entries()) {
        if (typeof item !== "number" || !Number.isFinite(item) || item < 0) failInput(`hookMs[${index}]`);
      }
      assertLane(sample, route);
      sample.signal?.throwIfAborted();
      const scope = { workspaceId: sample.workspaceId, sessionId: sample.sessionId };
      let receipt: { eligiblePrefixTokens: number } | null;
      try {
        receipt = await cache.current(scope, sample.signal);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
          failScope({ workspaceId: sample.workspaceId, port: "cache" });
        }
        throw error;
      }
      const cacheReadTokens = receipt ? receipt.eligiblePrefixTokens : 0;
      if (!Number.isSafeInteger(cacheReadTokens) || cacheReadTokens < 0) failInput("cache.eligiblePrefixTokens");
      sample.signal?.throwIfAborted();
      let cloneBytes: number;
      try {
        cloneBytes = await clone.measure(scope, sample.signal);
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "PCR_RETRIEVAL_SCOPE_DENIED") {
          failScope({ workspaceId: sample.workspaceId, port: "clone" });
        }
        throw error;
      }
      if (!Number.isSafeInteger(cloneBytes) || cloneBytes < 0) failInput("cloneBytes");
      return Object.freeze({
        hookP50Ms: percentile(sample.hookMs, 0.5),
        hookP95Ms: percentile(sample.hookMs, 0.95),
        cacheEligibleRatio: cacheReadTokens / sample.promptTokens,
        cacheReadTokens,
        cloneBytes,
      });
    },
  };
}
