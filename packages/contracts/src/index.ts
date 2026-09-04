import type { HostContentBlock, HostSessionCursor } from "./types.js";

export * from "./canonical.js";
export * from "./errors.js";
export * from "./hash.js";
export * from "./ids.js";
export * from "./identity.js";
export * from "./package-boundary.js";
export * from "./providers.js";
export * from "./semantic.js";
export * from "./types.js";
export * from "./v2.js";

/** Stable internal callback shapes shared by host adapters and runtime wiring. */
export interface WorkspaceCallbackContext {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
}

export interface UserInputCallbackInput {
  operationId: string;
  cursor: HostSessionCursor;
  content: HostContentBlock[];
  capturedAt: number;
}

export interface CursorCallbackInput {
  cursor: HostSessionCursor;
  signal?: AbortSignal;
}

/**
 * Provenance for token counters that may come from the host, a persisted
 * assistant entry, or an estimator.  `unavailable` is intentionally explicit:
 * an unknown counter is represented by `null`, never by a synthetic zero.
 */
export type TokenSource = "host" | "assistant-entry" | "estimated" | "unavailable";

export interface TokenMeasurement {
  value: number | null;
  source: TokenSource;
}

/** Token counters attached to a request usage record. */
export interface TokenUsageProvenance {
  serializedInputTokens: TokenMeasurement;
  providerReservedTokens: TokenMeasurement;
  uncachedInputTokens: TokenMeasurement;
  cacheReadTokens: TokenMeasurement;
  cacheWriteTokens: TokenMeasurement;
  outputTokens: TokenMeasurement;
  totalBilledTokens: TokenMeasurement;
}

/** Distinct accounting layers for evaluation and publication evidence. */
export interface EvaluationUsageLayers {
  checkpoint: { tokens: TokenMeasurement };
  materializedView: { tokens: TokenMeasurement };
  request: { inputTokens: TokenMeasurement; outputTokens: TokenMeasurement };
  providerUsage: { totalTokens: TokenMeasurement };
}

/** Backwards-compatible aliases for callers that use the shorter vocabulary. */
export type TokenValue = TokenMeasurement;
export type TokenField = TokenMeasurement;
