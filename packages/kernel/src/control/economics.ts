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

export function hashSensitiveDimensions(event: unknown): Record<string, unknown> {
  const raw = event !== null && typeof event === "object" && !Array.isArray(event) ? { ...(event as Record<string, unknown>) } : {};
  const dimensions: Record<string, string | number | boolean | null> = {};
  const incoming = raw.dimensions !== null && typeof raw.dimensions === "object" ? (raw.dimensions as Record<string, unknown>) : raw;
  for (const [key, value] of Object.entries(incoming)) {
    if (key === "prompt" || key === "message" || key === "blob" || key === "text") continue;
    if (typeof value === "string" && looksSensitive(key, value)) {
      dimensions[key] = domainHash("telemetry-dim", value);
    } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      dimensions[key] = value;
    }
  }
  return {
    name: typeof raw.name === "string" ? raw.name : "pcr.event",
    timestamp: typeof raw.timestamp === "number" ? raw.timestamp : 0,
    workspaceId: typeof raw.workspaceId === "string" ? raw.workspaceId : "ws_opaque",
    sessionId: typeof raw.sessionId === "string" ? raw.sessionId : "s_opaque",
    viewId: typeof raw.viewId === "string" || raw.viewId === null ? raw.viewId : null,
    dimensions,
    metrics: asMetrics(raw.metrics),
  };
}

export function schemaParseTelemetry(event: Record<string, unknown>): TelemetryEvent {
  const dimensions = (event.dimensions ?? {}) as TelemetryEvent["dimensions"];
  return {
    schemaVersion: 1,
    eventId: `te_${domainHash("telemetry-event", event).slice(0, 16)}`,
    name: String(event.name ?? "pcr.event"),
    timestamp: Number(event.timestamp ?? 0),
    workspaceId: String(event.workspaceId ?? "ws_opaque"),
    sessionId: String(event.sessionId ?? "s_opaque"),
    viewId: (event.viewId as string | null) ?? null,
    dimensions,
    metrics: asMetrics(event.metrics),
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
