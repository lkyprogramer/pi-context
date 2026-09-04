export interface CheckpointMetadataSample {
  summaryTokens: number;
  payloadTokens: number;
  cacheEligibleTokens: number;
  quality: number;
}

export interface CheckpointMetadataAblation {
  tokenDelta: number;
  payloadDelta: number;
  cacheDelta: number;
  qualityNonInferior: boolean;
}

export function compareCheckpointMetadata(
  baseline: CheckpointMetadataSample,
  ablated: CheckpointMetadataSample,
): CheckpointMetadataAblation {
  return {
    tokenDelta: baseline.summaryTokens - ablated.summaryTokens,
    payloadDelta: baseline.payloadTokens - ablated.payloadTokens,
    cacheDelta: baseline.cacheEligibleTokens - ablated.cacheEligibleTokens,
    qualityNonInferior: ablated.quality >= baseline.quality,
  };
}

export type CacheLayoutArm = "full-metadata" | "short-ref" | "no-heads" | "directory-first";

export type CacheMetricSource = "provider" | "estimated" | "unavailable";

export interface CacheLayoutSample {
  arm: CacheLayoutArm;
  /** Null means that the provider did not expose the field. It must not be replaced with zero. */
  quality: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  uncachedInputTokens: number | null;
  eligiblePrefixTokens: number | null;
  firstDifferentSection: string | null;
  /** Monetary cost is only populated when a complete price/discount snapshot exists. */
  billedCost: number | null;
  /** Per-field provenance for evidence consumers; omitted by legacy callers. */
  metricSources?: Readonly<{
    cacheReadTokens: CacheMetricSource;
    cacheWriteTokens: CacheMetricSource;
    uncachedInputTokens: CacheMetricSource;
    eligiblePrefixTokens: CacheMetricSource;
    billedCost: CacheMetricSource;
  }>;
}

export interface CacheLayoutComparison {
  qualityHardGate: boolean;
  winner: CacheLayoutArm | null;
  samples: CacheLayoutSample[];
}

export function compareCacheLayouts(samples: readonly CacheLayoutSample[]): CacheLayoutComparison {
  // An empty set (or an unknown quality) is not a passing quality gate.
  const qualityHardGate = samples.length > 0 && samples.every((sample) => sample.quality !== null && sample.quality >= 1);
  if (!qualityHardGate) {
    return { qualityHardGate: false, winner: null, samples: [...samples] };
  }
  // Never rank a sample whose monetary cost is unavailable. This keeps
  // provider usage gaps from becoming a fabricated zero-cost win.
  const ranked = samples.filter((sample) => sample.billedCost !== null);
  const winner = [...ranked].sort((left, right) => (
    (left.billedCost! - right.billedCost!)
    || ((right.eligiblePrefixTokens ?? -1) - (left.eligiblePrefixTokens ?? -1))
  ))[0];
  return { qualityHardGate: true, winner: winner?.arm ?? null, samples: [...samples] };
}

/**
 * Finds the first named section that differs between two materialized request
 * views. Sections are compared in order, so a later active turn cannot hide a
 * prefix difference that would affect provider cache reuse.
 */
export function firstDifferentSection(
  baseline: readonly { section: string; text: string }[],
  candidate: readonly { section: string; text: string }[],
): string | null {
  const length = Math.max(baseline.length, candidate.length);
  for (let index = 0; index < length; index += 1) {
    const left = baseline[index];
    const right = candidate[index];
    if (!left || !right || left.section !== right.section || left.text !== right.text) {
      return right?.section ?? left?.section ?? null;
    }
  }
  return null;
}
