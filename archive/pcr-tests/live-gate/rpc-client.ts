export interface RetryAttempt {
  attempt: number;
  ok: boolean;
  error?: string;
}

export type RetryResult<T> =
  | { ok: true; value: T; attempts: number; retried: boolean; attemptLog: readonly RetryAttempt[] }
  | { ok: false; error: unknown; exhausted: true; attempts: number; retried: boolean; attemptLog: readonly RetryAttempt[] };

export interface TransportRetryOptions {
  maxRetries?: number;
  isTransportError?: (error: unknown) => boolean;
  onAttempt?: (attempt: RetryAttempt) => void;
  attemptLogPath?: string;
}

function defaultTransportError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "UND_ERR_CONNECT_TIMEOUT"].includes(code)
    || /transport|network|socket|connect/i.test(error instanceof Error ? error.message : String(error));
}

/** Executes a request with a hard retry ceiling and a durable per-attempt record. */
export async function withTransportRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options: TransportRetryOptions = {},
): Promise<RetryResult<T>> {
  const maxRetries = options.maxRetries ?? 2;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0 || maxRetries > 2) {
    throw new RangeError("maxRetries must be an integer between 0 and 2");
  }
  const isTransportError = options.isTransportError ?? defaultTransportError;
  const attemptLog: RetryAttempt[] = [];
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    try {
      const value = await operation(attempt);
      const record = { attempt, ok: true } as const;
      attemptLog.push(record);
      if (options.attemptLogPath) appendFileSync(options.attemptLogPath, `${JSON.stringify(record)}\n`);
      options.onAttempt?.(record);
      return { ok: true, value, attempts: attempt, retried: attempt > 1, attemptLog: Object.freeze([...attemptLog]) };
    } catch (error) {
      const record = { attempt, ok: false, error: error instanceof Error ? error.message : String(error) };
      attemptLog.push(record);
      if (options.attemptLogPath) appendFileSync(options.attemptLogPath, `${JSON.stringify(record)}\n`);
      options.onAttempt?.(record);
      if (!isTransportError(error) || attempt > maxRetries) {
        return { ok: false, error, exhausted: true, attempts: attempt, retried: attempt > 1, attemptLog: Object.freeze([...attemptLog]) };
      }
    }
  }
  throw new Error("unreachable");
}
import { appendFileSync } from "node:fs";
