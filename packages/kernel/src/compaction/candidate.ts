import type { HostCheckpoint, HostMessage } from "../../../contracts/src/index.js";
import { checkpointManifest, hashCheckpointBody } from "./host-checkpoint.js";
import { renderHostCheckpoint } from "./render.js";
import { mustShrink } from "./shrink-gate.js";

export interface HostCompactionPreparation {
  tokensBefore: number;
  firstKeptEntryId: string;
  retainedTail?: HostMessage[];
  branchScope?: string;
  head?: string;
  directives?: Array<{ directiveId: string; quote: string }>;
  reason?: "threshold" | "overflow" | "manual";
}

export interface RuntimeState {
  checkpoint: HostCheckpoint;
  verifiedPointers?: Set<string>;
  branchScope?: string;
  head?: string;
  renderedTokens?: number;
  waitForSemantic?: boolean;
  counter: {
    countText(text: string): number;
    countMessages(messages: readonly HostMessage[]): number;
  };
}

export interface HostCompactionCandidate {
  summary: string;
  firstKeptEntryId: string;
  tokensBefore: number;
  estimatedTokensAfter: number;
  details: ReturnType<typeof checkpointManifest>;
}

export type CandidateResult =
  | { kind: "ready"; candidate: HostCompactionCandidate }
  | { kind: "rejected"; code: string };

export function buildHostCheckpoint(_preparation: HostCompactionPreparation, state: RuntimeState): HostCheckpoint {
  return state.checkpoint;
}

export async function buildDeterministicCheckpointCandidate(
  preparation: HostCompactionPreparation,
  state: RuntimeState,
): Promise<CandidateResult> {
  if (state.waitForSemantic && preparation.reason === "overflow") {
    state.waitForSemantic = false;
  }
  if (preparation.branchScope && state.branchScope && preparation.branchScope !== state.branchScope) {
    return { kind: "rejected", code: "PCR_CHECKPOINT_SOURCE_MISMATCH" };
  }
  if (preparation.head && state.head && preparation.head !== state.head) {
    return { kind: "rejected", code: "PCR_CHECKPOINT_SOURCE_MISMATCH" };
  }
  const checkpoint = buildHostCheckpoint(preparation, state);
  const pointers = checkpoint.pointers ?? [];
  if (state.verifiedPointers) {
    const unverified = pointers.filter((item) => !state.verifiedPointers?.has(item.ref));
    if (unverified.length > 0) return { kind: "rejected", code: "PCR_CHECKPOINT_POINTER_UNVERIFIED" };
  }
  const required = preparation.directives ?? [];
  if (required.some((item) => !checkpoint.directives.some((directive) => directive.directiveId === item.directiveId))) {
    return { kind: "rejected", code: "PCR_CHECKPOINT_DIRECTIVE_COVERAGE" };
  }
  const summary = renderHostCheckpoint(checkpoint);
  const tokensAfter =
    state.renderedTokens ??
    state.counter.countText(summary) + state.counter.countMessages(preparation.retainedTail ?? []);
  if (!mustShrink(tokensAfter, preparation.tokensBefore)) {
    return { kind: "rejected", code: "PCR_HOST_COMPACTION_NOT_SHRINKING" };
  }
  return {
    kind: "ready",
    candidate: {
      summary,
      firstKeptEntryId: preparation.firstKeptEntryId,
      tokensBefore: preparation.tokensBefore,
      estimatedTokensAfter: tokensAfter,
      details: checkpointManifest(checkpoint, hashCheckpointBody(summary)),
    },
  };
}
