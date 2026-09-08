import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { unknownCostStaysEmpty } from "../projection/budget.js";
import type { FoldEvent, RequestRecord, UsageRecord } from "../contracts.js";

export function normalizeUsage(raw: Record<string, unknown>, identity: { provider: string; model: string; purpose: UsageRecord["purpose"] }): UsageRecord {
  const num = (keys: string[]): number | null => {
    for (const key of keys) {
      const v = raw[key];
      if (typeof v === "number") return v;
    }
    return null;
  };
  return {
    provider: identity.provider,
    model: identity.model,
    purpose: identity.purpose,
    raw,
    uncachedInputTokens: num(["uncachedInputTokens", "input_tokens", "inputTokens", "prompt_tokens"]),
    cachedReadTokens: num(["cachedReadTokens", "cache_read_input_tokens", "cacheReadTokens"]),
    cachedWriteTokens: num(["cachedWriteTokens", "cache_creation_input_tokens", "cacheWriteTokens"]),
    outputTokens: num(["outputTokens", "output_tokens", "completion_tokens"]),
    monetaryCost: unknownCostStaysEmpty(num(["total_cost", "cost", "monetaryCost"])),
    currency: typeof raw.currency === "string" ? raw.currency : null,
    pricingIdentity: typeof raw.pricingIdentity === "string" ? raw.pricingIdentity : null,
    complete: unknownCostStaysEmpty(num(["total_cost", "cost", "monetaryCost"])) !== null,
  };
}

export interface TelemetrySink {
  sessionId: string;
  config: { telemetry: { jsonl: boolean; maxLogBytes: number } };
  telemetry: { lastRequests: RequestRecord[]; folds: number; foldEvents: FoldEvent[] };
}

function appendJsonl(state: TelemetrySink, payload: Record<string, unknown>): void {
  if (!state.config.telemetry.jsonl) return;
  const dir = join(homedir(), ".pi", "agent", "pctx", "telemetry");
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
    savedTokensEstimate: event.savedTokensEstimate,
    firstChangedIndex: event.firstChangedIndex,
    invalidatedTokensEstimate: event.invalidatedTokensEstimate,
    percentBefore: event.percentBefore,
  });
}
