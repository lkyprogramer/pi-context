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

export interface CacheLayoutSample {
  arm: CacheLayoutArm;
  quality: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  uncachedInputTokens: number;
  eligiblePrefixTokens: number;
  firstDifferentSection: string | null;
  billedCost: number;
}

export interface CacheLayoutComparison {
  qualityHardGate: boolean;
  winner: CacheLayoutArm | null;
  samples: CacheLayoutSample[];
}

export function compareCacheLayouts(samples: readonly CacheLayoutSample[]): CacheLayoutComparison {
  const qualityHardGate = samples.every((sample) => sample.quality >= 1);
  if (!qualityHardGate) {
    return { qualityHardGate: false, winner: null, samples: [...samples] };
  }
  const winner = [...samples].sort((left, right) => (
    (left.billedCost - right.billedCost)
    || (right.eligiblePrefixTokens - left.eligiblePrefixTokens)
  ))[0];
  return { qualityHardGate: true, winner: winner?.arm ?? null, samples: [...samples] };
}
