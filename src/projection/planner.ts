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
import type { ActiveView } from "./view-contracts.js";

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
}): string {
  const sha = input.sourceHash.slice(0, 8);
  const outcome = input.isError ? "error" : "ok";
  return [
    "[pctx folded tool result; original retained in session log]",
    `tool=${input.toolName} call=${input.callId} outcome=${outcome} bytes=${input.bytes} sha256=${sha}`,
    `head: ${JSON.stringify(input.head)}`,
    `read with pctx_history(action="read", ref="${input.ref}")`,
  ].join("\n");
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
    });
    const s = estimateTokens(field.rawText) - estimateTokens(stub);
    if (s <= 0) continue;
    const replacement: FoldReplacement = {
      entryId: entry.id,
      blockIndex: field.blockIndex,
      sourceHash: field.ref.sourceHash,
      stub,
      originalBytes: bytes,
      savedTokensEstimate: s,
    };
    next.set(field.key, replacement);
    est -= s;
    saved += s;
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
