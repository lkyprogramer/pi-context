export type SessionStartReason = "new" | "resume" | "fork" | "reload";

export interface CatchUpResult {
  reason: SessionStartReason;
  degraded: boolean;
  pointerUnavailable: boolean;
}

export function catchUpSession(input: { reason: SessionStartReason; hasRawBlobs: boolean }): CatchUpResult {
  const pointerUnavailable = input.reason !== "new" && !input.hasRawBlobs;
  return {
    reason: input.reason,
    degraded: pointerUnavailable,
    pointerUnavailable,
  };
}
