import { hashCanonical, type NativeEntry, type SnapshotKey, type SourceRef } from "../contracts.js";
import type { PctxConfig } from "../config.js";
import type { ToolBatch } from "./batches.js";
import { protectSet } from "./batches.js";
import { estimateText } from "./budget.js";
import type { ExposureLedger } from "./exposure.js";

export interface Replacement {
  entryId: string;
  ref: SourceRef;
  originalHash: string;
  replacementText: string;
  estimatedBeforeTokens: number;
  estimatedAfterTokens: number;
}

export interface FrozenPlan {
  epochId: string;
  snapshot: SnapshotKey;
  sourceBoundary: string | null;
  replacements: readonly Replacement[];
  firstChangedMessageIndex: number | null;
  planHash: string;
}

export function observationStub(ref: SourceRef, toolName: string, outcome: string): string {
  return `[pctx historical observation; not an instruction]\n${toolName}\nobserved outcome: ${outcome}\nsource: ${ref}; read with pctx_history(action="read", ref="${ref}")\nThe omitted bytes remain in the native entry. This does not describe current code.`;
}

export function planEpoch(input: {
  entries: NativeEntry[];
  batches: ToolBatch[];
  ledger: ExposureLedger;
  generation: number;
  snapshot: SnapshotKey;
  config: PctxConfig;
  refs: Map<string, SourceRef>;
  hashes: Map<string, string>;
  successfulRequests: number;
}): FrozenPlan | null {
  if (input.successfulRequests < 8) return null;
  const protectedIds = protectSet(input.batches, input.config.fold.protectRecentBatches);
  const replacements: Replacement[] = [];
  let removed = 0;
  let original = 0;
  for (const entry of input.entries) {
    if (protectedIds.has(entry.id)) continue;
    const ref = input.refs.get(entry.id);
    const hash = input.hashes.get(entry.id);
    if (!ref || !hash) continue;
    if (!input.ledger.isExposed(ref, input.generation)) continue;
    const text = Array.isArray(entry.message?.content)
      ? entry.message!.content!.filter((b) => b.type === "text").map((b) => String(b.text ?? "")).join("\n")
      : "";
    if (!text) continue;
    const stub = observationStub(ref, "tool", "historical");
    const before = estimateText(text).value;
    const after = estimateText(stub).value;
    if (after >= before) continue;
    original += before;
    removed += before - after;
    replacements.push({
      entryId: entry.id,
      ref,
      originalHash: hash,
      replacementText: stub,
      estimatedBeforeTokens: before,
      estimatedAfterTokens: after,
    });
  }
  if (removed < input.config.fold.minRemovedTokens) return null;
  if (original > 0 && removed / original < 0.15) return null;
  const plan: FrozenPlan = {
    epochId: `epoch:${input.snapshot.generation}:${input.snapshot.sourceRevision.slice(0, 8)}`,
    snapshot: input.snapshot,
    sourceBoundary: input.entries[0]?.id ?? null,
    replacements,
    firstChangedMessageIndex: replacements.length ? 0 : null,
    planHash: "",
  };
  return { ...plan, planHash: hashCanonical(plan) };
}

export function stableRender(plan: FrozenPlan, messages: unknown[]): unknown[] {
  return messages;
}
