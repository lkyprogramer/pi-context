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
