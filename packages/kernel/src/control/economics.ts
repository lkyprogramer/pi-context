import { domainHash } from "../../../contracts/src/index.js";

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
