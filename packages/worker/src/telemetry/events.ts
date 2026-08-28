export type { TelemetryEvent } from "../../../kernel/src/control/economics.js";
export {
  calculateRealizedNetValue,
  sanitizeTelemetry,
  cacheInvariantOutputHash,
  pricedTokens,
  qualityRegressionCost,
} from "../../../kernel/src/control/economics.js";

export interface CachePrefixMetrics {
  eligiblePrefixTokens: number;
  firstDifference: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface BackgroundStaleMetrics {
  stale: number;
  wastedTokens: number;
  readyHit: number;
}

export function cachePrefixMetrics(input: CachePrefixMetrics): CachePrefixMetrics {
  return {
    eligiblePrefixTokens: input.eligiblePrefixTokens,
    firstDifference: input.firstDifference,
    cacheReadTokens: input.cacheReadTokens,
    cacheWriteTokens: input.cacheWriteTokens,
  };
}

export function backgroundStaleMetrics(input: BackgroundStaleMetrics): BackgroundStaleMetrics {
  return { stale: input.stale, wastedTokens: input.wastedTokens, readyHit: input.readyHit };
}
