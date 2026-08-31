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
}

export interface UsageSample {
  serializedInputTokens: number;
  provider?: Partial<{
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
  }>;
  cacheHit: boolean;
  overflowRetry: boolean;
  inputPricePerToken?: number;
  cacheReadPricePerToken?: number;
  cacheWritePricePerToken?: number;
  outputPricePerToken?: number;
}

export function reconcileUsage(sample: UsageSample): RequestUsage {
  const provider = sample.provider ?? {};
  const cacheReadTokens = sample.cacheHit
    ? (provider.cacheReadTokens ?? sample.serializedInputTokens)
    : (provider.cacheReadTokens ?? 0);
  const uncachedInputTokens = sample.cacheHit
    ? (provider.inputTokens ?? 0)
    : (provider.inputTokens ?? sample.serializedInputTokens);
  const cacheWriteTokens = sample.cacheHit ? 0 : (provider.cacheWriteTokens ?? 0);
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
  };
}
