import { buildSessionContext } from "@earendil-works/pi-coding-agent";
import type { RuntimeToolCtx } from "./status.js";

const MAX_PAGE_BYTES = 4096;
const CONTINUATION_RESERVE_TOKENS = 1024;

export function pageBudgetExceeded(offset: number): never {
  throw Object.assign(new Error(`Too little context for an evidence page; compact and retry at offset ${offset}.`), {
    code: "PCR_RETRIEVAL_BUDGET_EXCEEDED", details: { offset },
  });
}

/** A UTF-8 byte per token is a conservative output bound, including JSON escaping. */
export function pageByteBudget(ctx: RuntimeToolCtx | undefined, requestedTokens: number | undefined, offset: number): number {
  if (requestedTokens !== undefined && (!Number.isSafeInteger(requestedTokens) || requestedTokens <= 0)) {
    throw Object.assign(new Error("Invalid page token cap"), { code: "PCR_RETRIEVAL_INPUT_INVALID" });
  }
  let budget = Math.min(MAX_PAGE_BYTES, requestedTokens ?? MAX_PAGE_BYTES);
  const usage = ctx?.getContextUsage?.();
  const window = ctx?.model?.contextWindow ?? usage?.contextWindow;
  if (window !== undefined) {
    if (!Number.isFinite(window) || window <= 0) pageBudgetExceeded(offset);
    const output = ctx?.model?.maxTokens ?? CONTINUATION_RESERVE_TOKENS;
    const used = usage?.tokens;
    // Native reconstruction accounts for the retained tail/summary after compaction.
    // Only the unknown-usage path needs a branch walk.
    const historyTokens = used == null && ctx?.sessionManager
      ? buildSessionContext(ctx.sessionManager.getBranch()).messages.reduce((sum, message) => sum + Buffer.byteLength(JSON.stringify(message), "utf8"), 0)
      : 0;
    // Before the first usage report, include the prompt and active tool schemas explicitly.
    const overhead = used == null
      ? Buffer.byteLength(ctx?.getSystemPrompt?.() ?? "", "utf8") + (ctx?.toolSchemaTokens ?? 0) + historyTokens
      : used;
    if (!Number.isFinite(overhead) || overhead < 0 || !Number.isFinite(output) || output < 0) pageBudgetExceeded(offset);
    budget = Math.min(budget, Math.floor((window - output - overhead - CONTINUATION_RESERVE_TOKENS) / 2));
  }
  if (budget < 1) pageBudgetExceeded(offset);
  return budget;
}

export function requireOffset(value: number | undefined, fallback: number): number {
  const offset = value ?? fallback;
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw Object.assign(new Error("invalid range"), { code: "PCR_INVALID_RANGE" });
  }
  return offset;
}
