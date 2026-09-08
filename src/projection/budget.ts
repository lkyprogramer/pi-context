import { type PctxConfig, type ReadBudget } from "../contracts.js";

export function unknownCostStaysEmpty(value: number | null | undefined): number | null {
  return value === undefined || value === null || Number.isNaN(value) ? null : value;
}

const MIN_REMAINING_TOKENS = 512;

export function readBudgetFor(
  config: PctxConfig,
  callerMax: number | undefined,
  usage: { tokens: number | null; contextWindow: number; percent: number | null } | null,
): ReadBudget | { insufficient: true } {
  if (usage && usage.tokens != null && Number.isFinite(usage.tokens) && usage.contextWindow > 0) {
    const remaining = usage.contextWindow - usage.tokens;
    if (remaining < MIN_REMAINING_TOKENS) return { insufficient: true };
    const windowShare = Math.floor(remaining * 0.25);
    const maxTokens = Math.min(config.history.readMaxTokens, callerMax ?? config.history.readMaxTokens, windowShare);
    if (maxTokens < 1) return { insufficient: true };
    return {
      maxTokens,
      maxBytes: config.history.readMaxBytes,
      estimateKind: "provider-window",
    };
  }
  return {
    maxTokens: Math.min(config.history.readMaxTokens, callerMax ?? config.history.readMaxTokens),
    maxBytes: config.history.readMaxBytes,
    estimateKind: "character-estimate",
  };
}
