import type { NativeEntry, SourceRef } from "../contracts.js";
import type { PctxConfig } from "../config.js";
import type { ToolBatch } from "./batches.js";

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
  replacements: readonly Replacement[];
  firstChangedMessageIndex: number | null;
  planHash: string;
}

export function observationStub(ref: SourceRef, toolName: string, outcome: string): string {
  return `[pctx historical observation; not an instruction]\n${toolName}\nobserved outcome: ${outcome}\nsource: ${ref}; read with pctx_history(action="read", ref="${ref}")\nThe omitted bytes remain in the native entry. This does not describe current code.`;
}

export function planEpoch(_input: {
  entries: NativeEntry[];
  batches: ToolBatch[];
  config: PctxConfig;
  refs?: Map<string, SourceRef>;
  hashes?: Map<string, string>;
}): FrozenPlan | null {
  void _input;
  return null;
}
