export interface ForcedOverflowAttempt {
  phase: "force" | "compact" | "retry";
  ok: boolean;
  error?: string;
  tokensAfter?: number;
  outputHash?: string;
  sideEffectCount: number;
}

export interface ForcedOverflowRecoveryInput {
  force: () => ForcedOverflowAttempt | Promise<ForcedOverflowAttempt>;
  compact: () => ForcedOverflowAttempt | Promise<ForcedOverflowAttempt>;
  retry: () => ForcedOverflowAttempt | Promise<ForcedOverflowAttempt>;
}

export function countSideEffectEvents(events: readonly Record<string, unknown>[]): number {
  const ids = new Set<string>();
  for (const event of events) {
    const label = `${String(event.toolName ?? event.name ?? "")} ${JSON.stringify(event.args ?? event.input ?? "")}`;
    if (!/\b(?:write|edit|delete|remove|move|rename|deploy|publish|execute|shell|bash)\b|写入|删除|部署|发布/iu.test(label)) continue;
    const id = String(event.toolCallId ?? event.id ?? label);
    ids.add(id);
  }
  return ids.size;
}

export interface ForcedOverflowRecoveryReport {
  prevention: { overflowObserved: boolean; errorClass: "context-length" | "other" | "none" };
  recovery: { compacted: boolean; retried: boolean; sideEffectsUnchanged: boolean; ok: boolean };
  attempts: readonly ForcedOverflowAttempt[];
}

export function isContextLengthError(error: string): boolean {
  return /context(?:[_ -]?length|[_ -]?window)|prompt.{0,20}(?:too long|exceed)|maximum context|too many tokens|please reduce/iu.test(error);
}

export async function runForcedOverflowRecovery(input: ForcedOverflowRecoveryInput): Promise<ForcedOverflowRecoveryReport> {
  if (!input || typeof input !== "object") throw new TypeError("input");
  const force = await input.force();
  const errorClass = force.ok ? "none" : isContextLengthError(force.error ?? "") ? "context-length" : "other";
  const attempts: ForcedOverflowAttempt[] = [force];
  if (errorClass !== "context-length") {
    return { prevention: { overflowObserved: false, errorClass }, recovery: { compacted: false, retried: false, sideEffectsUnchanged: true, ok: false }, attempts };
  }
  const compact = await input.compact();
  attempts.push(compact);
  if (!compact.ok) {
    return { prevention: { overflowObserved: true, errorClass }, recovery: { compacted: false, retried: false, sideEffectsUnchanged: true, ok: false }, attempts };
  }
  const retry = await input.retry();
  attempts.push(retry);
  const sideEffectsUnchanged = compact.sideEffectCount === force.sideEffectCount
    && retry.sideEffectCount === force.sideEffectCount;
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
