export interface ForcedOverflowAttempt {
  phase: "force" | "compact" | "retry";
  ok: boolean;
  error?: string;
  tokensAfter?: number;
  outputHash?: string;
  sideEffectCount: number;
}

export interface ForcedOverflowRecoveryInput {
  force: () => ForcedOverflowAttempt;
  compact: () => ForcedOverflowAttempt;
  retry: () => ForcedOverflowAttempt;
}

export interface ForcedOverflowRecoveryReport {
  prevention: { overflowObserved: boolean; errorClass: "context-length" | "other" | "none" };
  recovery: { compacted: boolean; retried: boolean; sideEffectsUnchanged: boolean; ok: boolean };
  attempts: readonly ForcedOverflowAttempt[];
}

export function isContextLengthError(error: string): boolean {
  return /context(?:[_ -]?length| window)|prompt.{0,20}(?:too long|exceed)|maximum context/iu.test(error);
}

export function runForcedOverflowRecovery(input: ForcedOverflowRecoveryInput): ForcedOverflowRecoveryReport {
  if (!input || typeof input !== "object") throw new TypeError("input");
  const force = input.force();
  const errorClass = force.ok ? "none" : isContextLengthError(force.error ?? "") ? "context-length" : "other";
  const attempts: ForcedOverflowAttempt[] = [force];
  if (errorClass !== "context-length") {
    return { prevention: { overflowObserved: false, errorClass }, recovery: { compacted: false, retried: false, sideEffectsUnchanged: true, ok: false }, attempts };
  }
  const compact = input.compact();
  attempts.push(compact);
  if (!compact.ok) {
    return { prevention: { overflowObserved: true, errorClass }, recovery: { compacted: false, retried: false, sideEffectsUnchanged: true, ok: false }, attempts };
  }
  const retry = input.retry();
  attempts.push(retry);
  const sideEffectsUnchanged = retry.sideEffectCount === force.sideEffectCount;
  return {
    prevention: { overflowObserved: true, errorClass },
    recovery: {
      compacted: true,
      retried: retry.ok,
      sideEffectsUnchanged,
      ok: retry.ok && sideEffectsUnchanged,
    },
    attempts,
  };
}
