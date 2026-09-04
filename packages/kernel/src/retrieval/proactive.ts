import { estimateTextTokens } from "../budget/token-counter.js";

/**
 * Stable per-layer ceilings for volatile retrieval context.
 *
 * Directory and recall are both rendered in the same volatile augmentation
 * zone. Keeping their individual ceilings explicit makes the resulting page
 * deterministic and leaves a fixed aggregate ceiling for callers that need a
 * single accounting number.
 */
export const DEFAULT_RETRIEVAL_BUDGETS = Object.freeze({
  directoryTokens: 128,
  recallTokens: 256,
  pageTokens: 384,
  directoryItems: 16,
});

export interface DirectoryPointer {
  ref: string;
  kind: string;
}

export interface BoundedDirectory {
  items: DirectoryPointer[];
  omitted: Array<{ ref: string; reason: "budget" | "duplicate" }>;
  tokenEstimate: number;
}

export interface RecallPageItem {
  evidenceId: string;
  quote: string;
  tokens: number;
  required?: boolean;
}

export interface BoundedRecallPage<T extends RecallPageItem = RecallPageItem> {
  items: T[];
  omitted: Array<{ evidenceId: string; reason: "budget" | "duplicate" }>;
  tokenEstimate: number;
  abstained: boolean;
}

function requireBudget(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`PCR_RETRIEVAL_BUDGET_INVALID:${field}`);
  }
  return value;
}

function pointerCost(pointer: DirectoryPointer): number {
  return estimateTextTokens(`${pointer.kind} ${pointer.ref}`);
}

/** Select directory pointers in source order without exceeding the token/item ceilings. */
export function boundDirectoryPointers(
  pointers: readonly DirectoryPointer[],
  maxTokens = DEFAULT_RETRIEVAL_BUDGETS.directoryTokens,
  maxItems = DEFAULT_RETRIEVAL_BUDGETS.directoryItems,
): BoundedDirectory {
  requireBudget(maxTokens, "directoryTokens");
  requireBudget(maxItems, "directoryItems");
  if (!Array.isArray(pointers)) throw new TypeError("PCR_RETRIEVAL_INPUT_INVALID:directory");

  const items: DirectoryPointer[] = [];
  const omitted: BoundedDirectory["omitted"] = [];
  const seen = new Set<string>();
  let tokenEstimate = 0;
  for (const pointer of pointers) {
    if (!pointer || typeof pointer !== "object" || typeof pointer.ref !== "string" || pointer.ref.length === 0
      || typeof pointer.kind !== "string" || pointer.kind.length === 0) {
      throw new TypeError("PCR_RETRIEVAL_INPUT_INVALID:directory[]");
    }
    if (seen.has(pointer.ref)) {
      omitted.push({ ref: pointer.ref, reason: "duplicate" });
      continue;
    }
    seen.add(pointer.ref);
    if (items.length >= maxItems || tokenEstimate + pointerCost(pointer) > maxTokens) {
      omitted.push({ ref: pointer.ref, reason: "budget" });
      continue;
    }
    items.push({ ref: pointer.ref, kind: pointer.kind });
    tokenEstimate += pointerCost(pointer);
  }
  return { items, omitted, tokenEstimate };
}

/** Select recall items in source order, deduplicating evidence and quotes under a hard page budget. */
export function boundRecallPage<T extends RecallPageItem>(
  items: readonly T[],
  maxTokens = DEFAULT_RETRIEVAL_BUDGETS.recallTokens,
): BoundedRecallPage<T> {
  requireBudget(maxTokens, "recallTokens");
  if (!Array.isArray(items)) throw new TypeError("PCR_RETRIEVAL_INPUT_INVALID:recall");

  const selected: T[] = [];
  const omitted: BoundedRecallPage<T>["omitted"] = [];
  const seenIds = new Set<string>();
  const seenQuotes = new Set<string>();
  let tokenEstimate = 0;
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.evidenceId !== "string" || item.evidenceId.length === 0
      || typeof item.quote !== "string" || item.quote.length === 0
      || !Number.isSafeInteger(item.tokens) || item.tokens <= 0) {
      throw new TypeError("PCR_RETRIEVAL_INPUT_INVALID:recall[]");
    }
    if (seenIds.has(item.evidenceId) || seenQuotes.has(item.quote)) {
      omitted.push({ evidenceId: item.evidenceId, reason: "duplicate" });
      continue;
    }
    seenIds.add(item.evidenceId);
    seenQuotes.add(item.quote);
    // Recompute from the quote and never trust a lower caller estimate. This
    // keeps the bound aligned with materializer/token-counter semantics.
    const measuredTokens = Math.max(item.tokens, estimateTextTokens(item.quote));
    // A required item cannot bypass the hard page ceiling: callers should
    // represent truly mandatory directives in the hard-directive section.
    if (tokenEstimate + measuredTokens > maxTokens) {
      omitted.push({ evidenceId: item.evidenceId, reason: "budget" });
      continue;
    }
    selected.push(item);
    tokenEstimate += measuredTokens;
  }
  return {
    items: selected,
    omitted,
    tokenEstimate,
    abstained: selected.length === 0,
  };
}

/** The aggregate ceiling for the Directory + Recall page in one volatile layer. */
export function retrievalPageTokenEstimate(input: {
  directoryTokens: number;
  recallTokens: number;
}): number {
  if (!input || typeof input !== "object") throw new TypeError("PCR_RETRIEVAL_INPUT_INVALID:page");
  const directoryTokens = requireBudget(input.directoryTokens, "directoryTokens");
  const recallTokens = requireBudget(input.recallTokens, "recallTokens");
  const total = directoryTokens + recallTokens;
  if (total > DEFAULT_RETRIEVAL_BUDGETS.pageTokens) {
    throw new TypeError("PCR_RETRIEVAL_BUDGET_INVALID:pageTokens");
  }
  return total;
}
