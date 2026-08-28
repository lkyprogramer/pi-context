export interface CapturedObservation {
  toolName: string;
  rawBlobId?: string;
  sourceContentHash?: string;
  sourceClass?: string;
  text?: string;
  bytes?: number;
}

export interface ReducerLimits {
  maxMs: number;
  maxBytes: number;
}

export interface ReducerOutput {
  visibleText: string;
  facts: unknown[];
  artifacts?: unknown[];
  details?: unknown;
  diagnostics?: unknown[];
  fallback?: boolean;
}

export interface ObservationReducer {
  readonly id: string;
  readonly revision: string;
  matches(input: CapturedObservation): boolean;
  reduce(input: CapturedObservation, limits: ReducerLimits): Promise<ReducerOutput>;
}

export interface ReducedObservation extends ReducerOutput {
  reducer: { id: string; revision: string };
  rawBlobId?: string;
  sourceContentHash?: string;
  sourceClass?: string;
}

export const DEFAULT_LIMITS: ReducerLimits = { maxMs: 50, maxBytes: 64 * 1024 };
