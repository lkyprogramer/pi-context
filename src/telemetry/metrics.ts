export interface RequestMetrics {
  runId: string;
  generation: number;
  profile: string;
  mappedSources: number;
  transforms: number;
  estimatedTokens: number;
  estimateMethod: string;
  firstChangedIndex: number | null;
  hookWallMs: number;
  scopeDenials: number;
  sourceMissing: number;
  exposureConfirmedCount: number;
}

export function emptyMetrics(generation: number, profile: string): RequestMetrics {
  return {
    runId: crypto.randomUUID(),
    generation,
    profile,
    mappedSources: 0,
    transforms: 0,
    estimatedTokens: 0,
    estimateMethod: "character-estimate",
    firstChangedIndex: null,
    hookWallMs: 0,
    scopeDenials: 0,
    sourceMissing: 0,
    exposureConfirmedCount: 0,
  };
}
