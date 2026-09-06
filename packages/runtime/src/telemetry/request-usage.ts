export type RequestUsagePhase = "compact" | "continuation" | "recall" | "retry";
export type InputSemantics = "exclusive-cache" | "inclusive-cache" | "unknown";

export interface RequestUsage {
  requestId: string;
  sessionId: string;
  phase: RequestUsagePhase;
  input: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  output: number | null;
  inputSemantics: InputSemantics;
  elapsedMs: number;
}

export interface TaskUsageTotal {
  logicalInput: number | null;
  output: number | null;
  knownRequests: number;
  totalRequests: number;
  knownLogicalInput: number;
  knownOutput: number;
}

const PHASES = new Set<RequestUsagePhase>(["compact", "continuation", "recall", "retry"]);
const SEMANTICS = new Set<InputSemantics>(["exclusive-cache", "inclusive-cache", "unknown"]);

function isToken(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}

export function declaredInputSemantics(value: unknown): InputSemantics {
  return typeof value === "string" && SEMANTICS.has(value as InputSemantics)
    ? value as InputSemantics
    : "unknown";
}

export function logicalInput(usage: RequestUsage): number | null {
  if (!usage || typeof usage !== "object") return null;
  if (usage.inputSemantics === "unknown") return null;
  if (!isToken(usage.input)) return null;
  if (usage.inputSemantics === "inclusive-cache") return usage.input;
  if (!isToken(usage.cacheRead) || !isToken(usage.cacheWrite)) return null;
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

function foldByRequestId(rows: readonly RequestUsage[]): RequestUsage[] {
  const latest = new Map<string, RequestUsage>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    if (typeof row.requestId !== "string" || row.requestId.length === 0) continue;
    if (!PHASES.has(row.phase)) continue;
    latest.set(row.requestId, row);
  }
  return [...latest.values()];
}

export function totalTaskUsage(rows: readonly RequestUsage[]): TaskUsageTotal {
  const unique = foldByRequestId(Array.isArray(rows) ? rows : []);
  let logical: number | null = 0;
  let output: number | null = 0;
  let knownLogicalInput = 0;
  let knownOutput = 0;
  let knownRequests = 0;
  for (const row of unique) {
    const nextLogical = logicalInput(row);
    if (nextLogical === null) {
      logical = null;
    } else {
      knownLogicalInput += nextLogical;
      if (logical !== null) logical += nextLogical;
    }
    if (!isToken(row.output)) {
      output = null;
    } else {
      knownOutput += row.output;
      if (output !== null) output += row.output;
    }
    if (nextLogical !== null && isToken(row.output)) knownRequests += 1;
  }
  return {
    logicalInput: unique.length === 0 ? 0 : logical,
    output: unique.length === 0 ? 0 : output,
    knownRequests,
    totalRequests: unique.length,
    knownLogicalInput,
    knownOutput,
  };
}

export interface RequestUsageLedger {
  upsert(row: RequestUsage): void;
  get(requestId: string): RequestUsage | undefined;
  list(sessionId?: string): RequestUsage[];
  total(sessionId?: string): TaskUsageTotal;
}

export function createRequestUsageLedger(): RequestUsageLedger {
  const rows = new Map<string, RequestUsage>();
  return {
    upsert(row) {
      if (!row || typeof row.requestId !== "string" || row.requestId.length === 0) return;
      if (typeof row.sessionId !== "string" || row.sessionId.length === 0) return;
      rows.set(row.requestId, {
        requestId: row.requestId,
        sessionId: row.sessionId,
        phase: PHASES.has(row.phase) ? row.phase : "continuation",
        input: isToken(row.input) ? row.input : null,
        cacheRead: isToken(row.cacheRead) ? row.cacheRead : null,
        cacheWrite: isToken(row.cacheWrite) ? row.cacheWrite : null,
        output: isToken(row.output) ? row.output : null,
        inputSemantics: declaredInputSemantics(row.inputSemantics),
        elapsedMs: isToken(row.elapsedMs) ? row.elapsedMs : 0,
      });
    },
    get(requestId) {
      return rows.get(requestId);
    },
    list(sessionId) {
      const all = [...rows.values()];
      return sessionId === undefined ? all : all.filter((row) => row.sessionId === sessionId);
    },
    total(sessionId) {
      return totalTaskUsage(this.list(sessionId));
    },
  };
}
