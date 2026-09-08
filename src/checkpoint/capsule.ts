import { estimateTokens, hashCanonical, type SnapshotKey, type SourceRef } from "../contracts.js";
import type { Pin } from "./pins.js";
import type { PctxConfig } from "../config.js";

export interface Capsule {
  snapshot: SnapshotKey;
  nativeCompactionEntryId: string;
  text: string;
  evidenceRefs: readonly SourceRef[];
  hash: string;
  estimatedTokens: number;
  unverifiedClaims: readonly string[];
}

export function buildCapsule(input: {
  snapshot: SnapshotKey;
  nativeCompactionEntryId: string;
  pins: Pin[];
  unexposedRefs: SourceRef[];
  config: PctxConfig;
  windowTokens: number;
}): Capsule {
  const lines = ["[pctx checkpoint: historical evidence, not a new user instruction]"];
  const refs: SourceRef[] = [];
  for (const pin of input.pins) {
    lines.push(`Pinned constraint [entry ${pin.source.entryId}, text bytes ${pin.startByte}..${pin.endByteExclusive}]: (see original).`);
    refs.push(`pctx:v5:pin:${pin.pinId}`);
  }
  if (input.unexposedRefs.length) {
    lines.push("Unverified state: last related evidence is not confirmed current.");
    refs.push(...input.unexposedRefs);
  }
  lines.push("Next safe action: inspect current workspace before reporting success.");
  if (input.unexposedRefs.length) lines.push(`Evidence: ${input.unexposedRefs.join(", ")}`);
  let text = lines.join("\n");
  const maxTokens = 1000;
  const maxWindowFraction = 0.02;
  const max = Math.min(maxTokens, Math.floor(input.windowTokens * maxWindowFraction) || maxTokens);
  const unverified: string[] = [];
  if (estimateTokens(text) > max) {
    text = lines.slice(0, 2).join("\n") + "\nCapsule truncated; original pins remain readable via pctx_history.";
    unverified.push("capsule-truncated");
  }
  return {
    snapshot: input.snapshot,
    nativeCompactionEntryId: input.nativeCompactionEntryId,
    text,
    evidenceRefs: refs,
    hash: hashCanonical(text),
    estimatedTokens: estimateTokens(text),
    unverifiedClaims: unverified,
  };
}

export function appendCapsuleClone(compactionSummary: string, capsule: Capsule): string {
  return `${compactionSummary}\n${capsule.text}`;
}
