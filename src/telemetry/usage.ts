import { unknownCostStaysEmpty } from "../projection/budget.js";
import type { UsageRecord } from "../contracts.js";

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
