import { domainHash, type TokenMeasurement, type TokenSource, type TokenUsageProvenance } from "../../../contracts/src/index.js";

export interface TelemetryEvent {
  schemaVersion: 1;
  eventId: string;
  name: string;
  timestamp: number;
  workspaceId: string;
  sessionId: string;
  viewId: string | null;
  dimensions: Record<string, string | number | boolean | null>;
  metrics: Record<string, number>;
}

export interface EconomicsSample {
  avoidedInput: number;
  avoidedOverflow: number;
  summary: number;
  cacheRewrite: number;
  recall: number;
  qualityRegression: number;
  staleBackground: number;
  taskSucceeded?: boolean;
}

/** Provider counters as exposed by a host or recovered assistant entry. */
export interface TokenUsageProvenanceInput {
  serializedInputTokens: number;
  providerReservedTokens?: number;
  providerReservedSource?: Extract<TokenSource, "host" | "estimated" | "unavailable">;
  providerUsage?: Partial<{
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  }>;
  /** Identifies whether providerUsage came directly from the host or an assistant entry. */
  providerUsageSource?: Extract<TokenSource, "host" | "assistant-entry">;
  cacheHit?: boolean;
  /** Optional immutable price snapshot used to derive a monetary amount. */
  pricing?: TokenPricingTable;
}

export interface TokenPricingTable {
  version: string;
  currency: string;
  inputPerToken: number;
  outputPerToken: number;
  /** Fraction of the regular input price charged for cache reads. */
  cacheReadDiscount?: number;
  cacheWritePerToken?: number;
}

export interface MonetaryCost {
  value: number;
  currency: string;
  priceTableVersion: string;
}

export interface TokenEconomicsBreakdown {
  /** Serialized request size, independent of provider cache accounting. */
  logicalTokens: TokenMeasurement;
  /** Provider-observed input tokens (uncached input plus cache reads). */
  effectiveInput: TokenMeasurement;
  /** Null when usage or the complete price/cache-discount snapshot is unknown. */
  monetaryCost: MonetaryCost | null;
}

function validToken(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/** Construct a source-bearing token field, failing closed for invalid values. */
export function tokenMeasurement(value: unknown, source: TokenSource): TokenMeasurement {
  if (source === "unavailable") return { value: null, source };
  return validToken(value) ? { value, source } : { value: null, source: "unavailable" };
}

function providerMeasurement(
  value: unknown,
  source: Extract<TokenSource, "host" | "assistant-entry"> | undefined,
): TokenMeasurement {
  return source === undefined
    ? { value: null, source: "unavailable" }
    : tokenMeasurement(value, source);
}

function totalMeasurement(values: readonly TokenMeasurement[]): TokenMeasurement {
  if (values.some((entry) => entry.value === null)) return { value: null, source: "unavailable" };
  const value = values.reduce((sum, entry) => sum + (entry.value ?? 0), 0);
  const sources = new Set(values.map((entry) => entry.source));
  const source = sources.size === 1 ? values[0]!.source : "estimated";
  return tokenMeasurement(value, source);
}

/**
 * Attach explicit provenance to provider reserve/cache usage.
 *
 * Missing provider counters remain `null + unavailable`; in particular they
 * are not silently converted to the historical numeric zero fallback.
 */
export function createTokenUsageProvenance(input: TokenUsageProvenanceInput): TokenUsageProvenance & TokenEconomicsBreakdown {
  const serializedInputTokens = tokenMeasurement(input.serializedInputTokens, "estimated");
  const reserveSource = input.providerReservedSource
    ?? (input.providerReservedTokens === undefined ? "unavailable" : "host");
  const providerReservedTokens = reserveSource === "unavailable"
    ? { value: null, source: "unavailable" as const }
    : tokenMeasurement(input.providerReservedTokens, reserveSource);
  const provider = input.providerUsage;
  const providerSource = provider === undefined ? undefined : (input.providerUsageSource ?? "host");
  const cacheHit = input.cacheHit ?? (validToken(provider?.cacheReadTokens) && provider!.cacheReadTokens! > 0);
  const cacheReadTokens = provider?.cacheReadTokens !== undefined
    ? providerMeasurement(provider.cacheReadTokens, providerSource)
    : cacheHit
      ? tokenMeasurement(serializedInputTokens.value, "estimated")
      : { value: null, source: "unavailable" as const };
  const uncachedInputTokens = provider?.inputTokens !== undefined
    ? providerMeasurement(provider.inputTokens, providerSource)
    : cacheHit
      ? { value: null, source: "unavailable" as const }
      : tokenMeasurement(serializedInputTokens.value, "estimated");
  const cacheWriteTokens = provider?.cacheWriteTokens !== undefined
    ? providerMeasurement(provider.cacheWriteTokens, providerSource)
    : { value: null, source: "unavailable" as const };
  const outputTokens = provider?.outputTokens !== undefined
    ? providerMeasurement(provider.outputTokens, providerSource)
    : { value: null, source: "unavailable" as const };
  const totalBilledTokens = totalMeasurement([
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
  ]);
  const logicalTokens = serializedInputTokens;
  const effectiveInput = totalMeasurement([uncachedInputTokens, cacheReadTokens]);
  const monetaryCost = calculateMonetaryCost({
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    pricing: input.pricing,
  });
  return {
    serializedInputTokens,
    providerReservedTokens,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalBilledTokens,
    logicalTokens,
    effectiveInput,
    monetaryCost,
  };
}

function calculateMonetaryCost(input: {
  uncachedInputTokens: TokenMeasurement;
  cacheReadTokens: TokenMeasurement;
  cacheWriteTokens: TokenMeasurement;
  outputTokens: TokenMeasurement;
  pricing?: TokenPricingTable;
}): MonetaryCost | null {
  const pricing = input.pricing;
  if (!pricing || typeof pricing.version !== "string" || pricing.version.length === 0
    || typeof pricing.currency !== "string" || pricing.currency.length === 0
    || !validPrice(pricing.inputPerToken) || !validPrice(pricing.outputPerToken)) return null;
  const cacheReadDiscount = pricing.cacheReadDiscount;
  if (cacheReadDiscount === undefined || !validPrice(cacheReadDiscount) || cacheReadDiscount > 1) return null;
  const cacheWriteRate = pricing.cacheWritePerToken;
  if (input.cacheWriteTokens.value !== 0
    && (cacheWriteRate === undefined || !validPrice(cacheWriteRate))) return null;
  if ([input.uncachedInputTokens, input.cacheReadTokens, input.cacheWriteTokens, input.outputTokens]
    .some((entry) => entry.value === null)) return null;
  const value = (input.uncachedInputTokens.value! * pricing.inputPerToken)
    + (input.cacheReadTokens.value! * pricing.inputPerToken * cacheReadDiscount)
    + (input.cacheWriteTokens.value! * (cacheWriteRate ?? pricing.inputPerToken))
    + (input.outputTokens.value! * pricing.outputPerToken);
  return { value, currency: pricing.currency, priceTableVersion: pricing.version };
}

function validPrice(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function calculateRealizedNetValue(x: EconomicsSample): number {
  if (x.taskSucceeded === false) return 0;
  return x.avoidedInput + x.avoidedOverflow - x.summary - x.cacheRewrite - x.recall - x.qualityRegression - x.staleBackground;
}

export function qualityRegressionCost(input: { pairedBenchmark?: { before: number; after: number } }): number {
  if (!input.pairedBenchmark) return 0;
  return Math.max(0, input.pairedBenchmark.before - input.pairedBenchmark.after);
}

export function cacheInvariantOutputHash(body: unknown, _cacheEnabled: boolean): string {
  return domainHash("materialized-output", body);
}

export function pricedTokens(tokens: number, pricePerToken?: number): { tokens: number; currency?: number } {
  if (pricePerToken == null || !Number.isFinite(pricePerToken)) return { tokens };
  return { tokens, currency: tokens * pricePerToken };
}

export function sanitizeTelemetry(event: unknown): TelemetryEvent {
  return schemaParseTelemetry(hashSensitiveDimensions(event));
}

type TelemetryScalars = Omit<TelemetryEvent, "schemaVersion" | "eventId">;

function asObject(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = Reflect.get(value, key);
  }
  return out;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asScalar(value: unknown): string | number | boolean | null | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (value === null) return null;
  return undefined;
}

export function hashSensitiveDimensions(event: unknown): TelemetryScalars {
  const raw = asObject(event);
  const dimensions: Record<string, string | number | boolean | null> = {};
  const incoming = raw.dimensions !== undefined ? asObject(raw.dimensions) : raw;
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "prompt" || key === "message" || key === "blob" || key === "text") continue;
    if (typeof value === "string" && looksSensitive(key, value)) {
      dimensions[key] = domainHash("telemetry-dim", value);
      continue;
    }
    const scalar = asScalar(value);
    if (scalar !== undefined) dimensions[key] = scalar;
  }
  const viewIdValue = raw.viewId;
  const viewId = typeof viewIdValue === "string" ? viewIdValue : null;
  return {
    name: asString(raw.name, "pcr.event"),
    timestamp: asNumber(raw.timestamp, 0),
    workspaceId: asString(raw.workspaceId, "ws_opaque"),
    sessionId: asString(raw.sessionId, "s_opaque"),
    viewId,
    dimensions,
    metrics: asMetrics(raw.metrics),
  };
}

export function schemaParseTelemetry(event: TelemetryScalars): TelemetryEvent {
  const viewId = event.viewId === null || typeof event.viewId === "string" ? event.viewId : null;
  return {
    schemaVersion: 1,
    eventId: `te_${domainHash("telemetry-event", event).slice(0, 16)}`,
    name: event.name,
    timestamp: event.timestamp,
    workspaceId: event.workspaceId,
    sessionId: event.sessionId,
    viewId,
    dimensions: event.dimensions,
    metrics: event.metrics,
  };
}

function asMetrics(value: unknown): Record<string, number> {
  if (value === null || typeof value !== "object") return {};
  const metrics: Record<string, number> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === "number" && Number.isFinite(item)) metrics[key] = item;
  }
  return metrics;
}

function looksSensitive(key: string, value: string): boolean {
  return key === "path" || key === "query" || key === "error" || /\/|\\/.test(value) || /secret|token|key/i.test(key);
}
