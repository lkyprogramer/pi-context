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

export interface AssistantUsage {
  input: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  totalTokens: number | null;
}

export interface AssistantRecord {
  stopReason: string | null;
  usage: AssistantUsage | null;
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

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function recordAssistant(message: {
  stopReason?: string;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
    totalTokens?: unknown;
  };
}): AssistantRecord {
  const usage = message.usage;
  return {
    stopReason: typeof message.stopReason === "string" ? message.stopReason : null,
    usage: usage
      ? {
          input: num(usage.input),
          output: num(usage.output),
          cacheRead: num(usage.cacheRead),
          cacheWrite: num(usage.cacheWrite),
          totalTokens: num(usage.totalTokens),
        }
      : null,
  };
}
