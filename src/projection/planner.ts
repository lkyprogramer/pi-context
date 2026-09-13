import {
  estimateTokens,
  sha256Hex,
  utf8Bytes,
  type ContextUsageLike,
  type FoldPlan,
  type FoldReplacement,
  type NativeEntry,
  type PctxConfig,
  type Scope,
  type SourceRef,
  type ToolBatch,
} from "../contracts.js";
import { encodeRef } from "../history/refs.js";
import { toolCallIdOf } from "../pi/source-reader.js";
import { identityIncomplete, viewFromEntries } from "./active-view.js";
import { protectSet } from "./batches.js";
import type { StoredPlan } from "./plan-store.js";
import type { ActiveField, ActiveView } from "./view-contracts.js";

export function shouldFold(usage: ContextUsageLike | null, plan: FoldPlan | null, cfg: PctxConfig["fold"]): boolean {
  if (!usage || usage.percent == null) return false;
  if (!(usage.contextWindow > 0)) return false;
  if (usage.percent < cfg.triggerPercent) return false;
  if (!plan) return true;
  const need = (cfg.minRemovedTokens / usage.contextWindow) * 100;
  return usage.percent - plan.usagePercentAtPlan >= need;
}

export function stubHead(text: string, maxChars: number): string {
  if (!text.includes("\n") && !text.includes("\r")) return text.slice(0, maxChars);
  const first = text.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
  return first.slice(0, maxChars);
}

export function stubFor(input: {
  toolName: string;
  callId: string;
  isError: boolean;
  bytes: number;
  sourceHash: string;
  head: string;
  ref: SourceRef;
  entryId: string;
  blockIndex: number;
}): string {
  const sha = input.sourceHash.slice(0, 8);
  const outcome = input.isError ? "error" : "ok";
  // `id=` is the short ref pctx_history accepts; small models mistype the long base64 ref.
  const shortId = input.blockIndex === 0 ? input.entryId : `${input.entryId}:${input.blockIndex}`;
  return [
    "[pctx folded tool result; original retained in session log]",
    `tool=${input.toolName} call=${input.callId} outcome=${outcome} bytes=${input.bytes} sha256=${sha} id=${shortId}`,
    `head: ${JSON.stringify(input.head)}`,
    `read: pctx_history(action="read", ref="${shortId}")  full ref: ${input.ref}`,
  ].join("\n");
}

/** Build the replacement for one live field; null when the stub would not be shorter than the text. */
function replacementFor(field: ActiveField, entry: NativeEntry, fold: PctxConfig["fold"]): FoldReplacement | null {
  const bytes = utf8Bytes(field.rawText).length;
  const callId = toolCallIdOf(entry.message) ?? "";
  const toolName = typeof entry.message?.toolName === "string" ? entry.message.toolName : "tool";
  const stub = stubFor({
    toolName,
    callId,
    isError: false,
    bytes,
    sourceHash: field.ref.sourceHash,
    head: stubHead(field.rawText, fold.stubHeadChars),
    ref: encodeRef(field.ref),
    entryId: entry.id,
    blockIndex: field.blockIndex,
  });
  const saved = estimateTokens(field.rawText) - estimateTokens(stub);
  if (saved <= 0) return null;
  return {
    entryId: entry.id,
    blockIndex: field.blockIndex,
    sourceHash: field.ref.sourceHash,
    stub,
    originalBytes: bytes,
    savedTokensEstimate: saved,
  };
}

function planIdOf(sessionId: string, boundary: string | null, modelId: string, keys: string[]): string {
  return sha256Hex(`${sessionId}|${boundary ?? ""}|${modelId}|${keys.slice().sort().join(",")}`).slice(0, 16);
}

export function planStillValid(
  plan: FoldPlan,
  input: { sessionId: string; compactionBoundary: string | null; modelId: string; configHash: string },
): boolean {
  return (
    plan.sessionId === input.sessionId &&
    plan.compactionBoundary === input.compactionBoundary &&
    plan.modelId === input.modelId &&
    plan.configHash === input.configHash
  );
}

/**
 * Re-admit a plan persisted by an earlier process. Identity must still match
 * (planStillValid) and every stored locator must still be eligible on the current
 * branch: its field is in the active view with the same sourceHash, its entry is
 * derived-exposed, not isError and not inside the protected recent batches. The
 * file is only trusted for *which* fields were folded; stub text and token numbers
 * are recomputed from the live field, so nothing from disk reaches the prompt.
 * Locators that fail are dropped (the original text is sent, exactly as observe
 * would); an empty result means "no plan". The trigger percent is deliberately not
 * consulted here: usage only gates creating or growing a plan, never re-applying a
 * valid one — otherwise a cold process, whose usage estimate reflects the previously
 * folded prompt, would send the full history and oscillate between folded and unfolded.
 */
export function restorePlan(
  stored: StoredPlan,
  input: {
    view: ActiveView;
    exposed: ReadonlySet<string>;
    batches: ToolBatch[];
    modelId: string;
    configHash: string;
    fold: PctxConfig["fold"];
  },
): FoldPlan | null {
  const view = input.view;
  if (identityIncomplete(view.diagnostics)) return null;
  if (
    stored.workspaceId !== view.scope.workspaceId ||
    stored.sessionId !== view.scope.sessionId ||
    stored.compactionBoundary !== view.compactionBoundary ||
    stored.modelId !== input.modelId ||
    stored.configHash !== input.configHash
  ) {
    return null;
  }
  const protectedIds = protectSet(input.batches, input.fold.protectRecentBatches);
  const fields = new Map(view.fields.map((field) => [field.key, field]));
  const byId = new Map(view.branch.map((entry) => [entry.id, entry]));
  const kept = new Map<string, FoldReplacement>();
  for (const item of stored.replacements) {
    const field = fields.get(item.key);
    if (!field || field.ref.kind !== "text" || field.ref.sourceHash !== item.sourceHash) continue;
    const entry = byId.get(item.entryId);
    if (!entry || entry.message?.isError === true) continue;
    if (!input.exposed.has(entry.id) || protectedIds.has(entry.id)) continue;
    const replacement = replacementFor(field, entry, input.fold);
    if (replacement) kept.set(item.key, replacement);
  }
  if (kept.size === 0) return null;
  const keys = [...kept.keys()];
  const unchanged = keys.length === stored.replacements.length;
  return {
    planId: unchanged ? stored.planId : planIdOf(stored.sessionId, stored.compactionBoundary, stored.modelId, keys),
    sessionId: stored.sessionId,
    compactionBoundary: stored.compactionBoundary,
    modelId: stored.modelId,
    configHash: stored.configHash,
    createdAt: stored.createdAt,
    usagePercentAtPlan: stored.usagePercentAtPlan,
    replacements: kept,
    savedTokensEstimate: [...kept.values()].reduce((sum, item) => sum + item.savedTokensEstimate, 0),
  };
}

export function planFold(input: {
  scope: Scope;
  view?: ActiveView;
  entries?: readonly NativeEntry[];
  batches: ToolBatch[];
  exposed: ReadonlySet<string>;
  usage: ContextUsageLike;
  previous: FoldPlan | null;
  modelId: string;
  cfg: PctxConfig;
  configHash: string;
}): FoldPlan | null {
  const view = input.view ?? viewFromEntries(input.scope, input.entries ?? []);
  if (identityIncomplete(view.diagnostics)) return input.previous;
  const fold = input.cfg.fold;
  if (input.usage.percent == null || input.usage.percent < fold.triggerPercent) return input.previous;
  if (!(input.usage.contextWindow > 0)) return input.previous;
  const protectedIds = protectSet(input.batches, fold.protectRecentBatches);
  const viewKeys = new Set(view.fields.map((field) => field.key));
  const next = new Map<string, FoldReplacement>();
  for (const [key, item] of input.previous?.replacements ?? []) {
    if (viewKeys.has(key)) next.set(key, item);
  }
  const target = (input.usage.contextWindow * fold.targetPercent) / 100;
  let est = input.usage.tokens ?? (input.usage.percent / 100) * input.usage.contextWindow;
  let saved = 0;
  const byId = new Map(view.branch.map((entry) => [entry.id, entry]));

  for (const field of view.fields) {
    if (est <= target) break;
    const entry = byId.get(field.ref.entryId);
    if (!entry || !input.exposed.has(entry.id) || protectedIds.has(entry.id)) continue;
    if (entry.message?.isError === true) continue;
    const bytes = utf8Bytes(field.rawText).length;
    if (bytes < fold.minFoldableBytes) continue;
    if (next.has(field.key)) continue;
    if (field.ref.kind !== "text") continue;
    const replacement = replacementFor(field, entry, fold);
    if (!replacement) continue;
    next.set(field.key, replacement);
    est -= replacement.savedTokensEstimate;
    saved += replacement.savedTokensEstimate;
  }

  if (saved < fold.minRemovedTokens) return input.previous;
  const keys = [...next.keys()];
  const boundary = view.compactionBoundary;
  const totalSaved = [...next.values()].reduce((sum, item) => sum + item.savedTokensEstimate, 0);
  return {
    planId: planIdOf(input.scope.sessionId, boundary, input.modelId, keys),
    sessionId: input.scope.sessionId,
    compactionBoundary: boundary,
    modelId: input.modelId,
    configHash: input.configHash,
    createdAt: input.previous?.createdAt ?? new Date().toISOString(),
    usagePercentAtPlan: input.usage.percent,
    replacements: next,
    savedTokensEstimate: totalSaved,
  };
}
