import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { unknownCostStaysEmpty } from "../projection/budget.js";
import type { FoldEvent, RequestRecord, UsageRecord } from "../contracts.js";

export const PI_USAGE_MAPPING = "pi-openai-completions-0.85.1-disjoint";

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/** Pi.input is already fresh. Never subtract cacheRead again. */
export function mapPiDisjoint(raw: Record<string, unknown>): {
  freshInput: number | null;
  cachedRead: number | null;
  cachedWrite: number | null;
  output: number | null;
  logicalInput: number | null;
} {
  const freshInput = intOrNull(raw.input);
  const cachedRead = intOrNull(raw.cacheRead);
  const cachedWrite = intOrNull(raw.cacheWrite);
  const output = intOrNull(raw.output);
  const logicalInput = freshInput != null && cachedRead != null && cachedWrite != null
    ? freshInput + cachedRead + cachedWrite
    : null;
  return { freshInput, cachedRead, cachedWrite, output, logicalInput };
}

export function normalizeUsage(raw: Record<string, unknown>, identity: { provider: string; model: string; purpose: UsageRecord["purpose"] }): UsageRecord {
  const num = (keys: string[]): number | null => {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === "number") return v;
    }
    return null;
  };
  const pi = "input" in raw ? mapPiDisjoint(raw) : null;
  return {
    provider: identity.provider,
    model: identity.model,
    purpose: identity.purpose,
    raw,
    uncachedInputTokens: pi ? pi.freshInput : num(["uncachedInputTokens", "input_tokens", "inputTokens", "prompt_tokens"]),
    cachedReadTokens: pi ? pi.cachedRead : num(["cachedReadTokens", "cache_read_input_tokens", "cacheReadTokens"]),
    cachedWriteTokens: pi ? pi.cachedWrite : num(["cachedWriteTokens", "cache_creation_input_tokens", "cacheWriteTokens"]),
    outputTokens: pi ? pi.output : num(["outputTokens", "output_tokens", "completion_tokens"]),
    monetaryCost: unknownCostStaysEmpty(num(["total_cost", "cost", "monetaryCost"])),
    currency: typeof raw.currency === "string" ? raw.currency : null,
    pricingIdentity: typeof raw.pricingIdentity === "string" ? raw.pricingIdentity : null,
    complete: unknownCostStaysEmpty(num(["total_cost", "cost", "monetaryCost"])) !== null,
  };
}

export interface TelemetrySink {
  sessionId: string;
  agentDir?: string | null;
  config: { telemetry: { jsonl: boolean; maxLogBytes: number } };
  telemetry: { lastRequests: RequestRecord[]; folds: number; foldEvents: FoldEvent[] };
}

function appendJsonl(state: TelemetrySink, payload: Record<string, unknown>): void {
  if (!state.config.telemetry.jsonl) return;
  const root = state.agentDir || join(homedir(), ".pi", "agent");
  const dir = join(root, "pctx", "telemetry");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${state.sessionId}.jsonl`);
  const line = `${JSON.stringify(payload)}\n`;
  if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > state.config.telemetry.maxLogBytes) {
    renameSync(file, `${file}.1`);
  }
  appendFileSync(file, line);
}

export function recordRequest(state: TelemetrySink, record: RequestRecord): void {
  state.telemetry.lastRequests = [...state.telemetry.lastRequests, record].slice(-5);
  appendJsonl(state, {
    type: "request",
    at: record.at,
    sessionId: record.sessionId,
    profile: record.profile,
    planId: record.planId,
    replacementsApplied: record.replacementsApplied,
    contextPercentBefore: record.contextPercentBefore,
    stopReason: record.stopReason,
    ttftMs: record.ttftMs,
    hookToFirstDeltaMs: record.hookToFirstDeltaMs ?? null,
    requestId: record.requestId ?? null,
    purpose: record.purpose ?? "agent",
    mappingVersion: record.mappingVersion ?? PI_USAGE_MAPPING,
    input: record.usage.input,
    output: record.usage.output,
    cacheRead: record.usage.cacheRead,
    cacheWrite: record.usage.cacheWrite,
    totalTokens: record.usage.totalTokens,
  });
}

export function recordFold(state: TelemetrySink, event: FoldEvent): void {
  state.telemetry.folds += 1;
  state.telemetry.foldEvents = [...state.telemetry.foldEvents, event];
  appendJsonl(state, {
    type: "fold",
    at: event.at,
    sessionId: event.sessionId,
    planId: event.planId,
    reason: event.reason,
    added: event.added,
    addedEntryIds: event.addedEntryIds,
    savedTokensEstimate: event.savedTokensEstimate,
    firstChangedIndex: event.firstChangedIndex,
    invalidatedTokensEstimate: event.invalidatedTokensEstimate,
    percentBefore: event.percentBefore,
  });
}
