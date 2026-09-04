import type { TokenMeasurement, TokenSource, TokenUsageProvenance } from "@pcr/contracts";
import type { ProviderUsageField, ProviderUsageSources } from "../ports.js";

export const USAGE_PRICING_TABLE_VERSION = "route-v1";

export interface RequestUsage {
  serializedInputTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  totalBilledTokens: number;
  estimatedCost: number;
  tokenizerRevision: string;
  pricingTableVersion: string;
  tokenProvenance: TokenUsageProvenance;
}

export interface UsageSample {
  serializedInputTokens: number;
  provider?: Partial<{
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  }>;
  providerUsageSources?: ProviderUsageSources;
  providerReservedTokens?: number;
  providerReservedSource?: Extract<TokenSource, "host" | "estimated" | "unavailable">;
  cacheHit: boolean;
  overflowRetry: boolean;
  inputPricePerToken?: number;
  cacheReadPricePerToken?: number;
  cacheWritePricePerToken?: number;
  outputPricePerToken?: number;
}

export type EstimateErrorBucket = "lt5" | "lt15" | "lt30" | "gte30";

export function estimateErrorBucket(estimated: number, actual: number): EstimateErrorBucket {
  if (!Number.isFinite(estimated) || !Number.isFinite(actual) || estimated < 0 || actual < 0) {
    return "gte30";
  }
  const denom = Math.max(1, actual);
  const ratio = Math.abs(estimated - actual) / denom;
  if (ratio < 0.05) return "lt5";
  if (ratio < 0.15) return "lt15";
  if (ratio < 0.30) return "lt30";
  return "gte30";
}

export function bindUsageToView(
  usage: RequestUsage,
  view: { viewId: string; outputHash: string },
): RequestUsage & { viewId: string; outputHash: string } {
  return { ...usage, viewId: view.viewId, outputHash: view.outputHash };
}

export function reconcileUsage(sample: UsageSample): RequestUsage {
  const provider = sample.provider ?? {};
  const providerSources = sample.providerUsageSources ?? {};
  const providerSource = (field: ProviderUsageField): Extract<TokenSource, "host" | "assistant-entry"> => (
    providerSources[field] ?? "host"
  );
  const cacheReadTokens = sample.cacheHit
    ? (provider.cacheReadTokens ?? sample.serializedInputTokens)
    : (provider.cacheReadTokens ?? 0);
  const uncachedInputTokens = sample.cacheHit
    ? (provider.inputTokens ?? 0)
    : (provider.inputTokens ?? sample.serializedInputTokens);
  const cacheWriteTokens = provider.cacheWriteTokens ?? 0;
  const outputTokens = provider.outputTokens ?? 0;
  const inputPrice = sample.inputPricePerToken ?? 0;
  const cacheReadPrice = sample.cacheReadPricePerToken ?? 0;
  const cacheWritePrice = sample.cacheWritePricePerToken ?? inputPrice;
  const outputPrice = sample.outputPricePerToken ?? 0;
  const estimatedCost =
    uncachedInputTokens * inputPrice
    + cacheReadTokens * cacheReadPrice
    + cacheWriteTokens * cacheWritePrice
    + outputTokens * outputPrice;
  return {
    serializedInputTokens: sample.serializedInputTokens,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalBilledTokens: uncachedInputTokens + cacheReadTokens + cacheWriteTokens + outputTokens,
    estimatedCost,
    tokenizerRevision: sample.overflowRetry ? "overflow-retry" : USAGE_PRICING_TABLE_VERSION,
    pricingTableVersion: USAGE_PRICING_TABLE_VERSION,
    tokenProvenance: usageProvenance({
      serializedInputTokens: sample.serializedInputTokens,
      providerReservedTokens: sample.providerReservedTokens,
      providerReservedSource: sample.providerReservedSource,
      providerUsage: provider,
      providerUsageSources: providerSources,
      cacheHit: sample.cacheHit,
      values: {
        uncachedInputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        outputTokens,
      },
      providerSource,
    }),
  };
}

function validToken(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

function measurement(value: unknown, source: TokenSource): TokenMeasurement {
  if (source === "unavailable") return { value: null, source };
  return validToken(value) ? { value, source } : { value: null, source: "unavailable" };
}

function usageProvenance(input: {
  serializedInputTokens: number;
  providerReservedTokens?: number;
  providerReservedSource?: Extract<TokenSource, "host" | "estimated" | "unavailable">;
  providerUsage: Partial<Record<ProviderUsageField, number>>;
  providerUsageSources: ProviderUsageSources;
  cacheHit: boolean;
  values: {
    uncachedInputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  };
  providerSource: (field: ProviderUsageField) => Extract<TokenSource, "host" | "assistant-entry">;
}): TokenUsageProvenance {
  const serializedInputTokens = measurement(input.serializedInputTokens, "estimated");
  const reserveSource = input.providerReservedSource
    ?? (input.providerReservedTokens === undefined ? "unavailable" : "host");
  const providerReservedTokens = reserveSource === "unavailable"
    ? { value: null, source: "unavailable" as const }
    : measurement(input.providerReservedTokens, reserveSource);
  const providerField = (field: ProviderUsageField, value: number, fallback: TokenMeasurement): TokenMeasurement => (
    input.providerUsage[field] !== undefined
      ? measurement(value, input.providerUsageSources[field] ?? input.providerSource(field))
      : fallback
  );
  const cacheReadTokens = providerField(
    "cacheReadTokens",
    input.values.cacheReadTokens,
    input.cacheHit ? measurement(serializedInputTokens.value, "estimated") : { value: null, source: "unavailable" },
  );
  const uncachedInputTokens = providerField(
    "inputTokens",
    input.values.uncachedInputTokens,
    input.cacheHit ? { value: null, source: "unavailable" } : measurement(serializedInputTokens.value, "estimated"),
  );
  const cacheWriteTokens = providerField("cacheWriteTokens", input.values.cacheWriteTokens, { value: null, source: "unavailable" });
  const outputTokens = providerField("outputTokens", input.values.outputTokens, { value: null, source: "unavailable" });
  const totalBilledTokens = [uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens].some((entry) => entry.value === null)
    ? { value: null, source: "unavailable" as const }
    : measurement(
      [uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens].reduce((sum, entry) => sum + (entry.value ?? 0), 0),
      new Set([uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens].map((entry) => entry.source)).size === 1
        ? uncachedInputTokens.source
        : "estimated",
    );
  return {
    serializedInputTokens,
    providerReservedTokens,
    uncachedInputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens,
    totalBilledTokens,
  };
}
