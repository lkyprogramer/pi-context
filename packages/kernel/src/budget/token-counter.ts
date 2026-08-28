export interface BudgetEnvelope {
  contextWindow: number;
  maxOutputTokens: number;
  providerReservedTokens: number;
  effectiveMaxInputTokens?: number;
}

export function computeEffectiveInputBudget(input: BudgetEnvelope): number {
  if (input.contextWindow < 0 || input.maxOutputTokens < 0 || input.providerReservedTokens < 0) {
    throw Object.assign(new Error("PCR_BUDGET_INVALID_LIMIT"), { code: "PCR_BUDGET_INVALID_LIMIT" });
  }
  const adapterLimit = input.effectiveMaxInputTokens;
  if (adapterLimit !== undefined) return Math.max(0, adapterLimit);
  return Math.max(0, input.contextWindow - input.maxOutputTokens - input.providerReservedTokens);
}

export function pressure(now: number, predictedGrowth: number, effectiveInput: number): number {
  return effectiveInput === 0 ? Number.POSITIVE_INFINITY : (now + predictedGrowth) / effectiveInput;
}

export function estimateTextTokens(text: string): number {
  let tokens = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code > 0x1f300 && code < 0x1faff) tokens += 2;
    else if (code > 0x2e80) tokens += 1;
    else tokens += 0.25;
  }
  return Math.max(1, Math.ceil(tokens));
}

export function estimateMessages(messages: ReadonlyArray<{ content: string }>): number {
  return messages.reduce((sum, message) => sum + estimateTextTokens(message.content), 0);
}

export function capacityUnchangedByCache(input: BudgetEnvelope, _cacheReadTokens: number): number {
  return computeEffectiveInputBudget(input);
}

export function cacheCost(cacheReadTokens: number, cacheWriteTokens: number, prices: { read: number; write: number }): number {
  return cacheReadTokens * prices.read + cacheWriteTokens * prices.write;
}
