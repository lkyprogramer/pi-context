import type { ContextHookCtx } from "./context-hook.js";
import {
  ackHostCompaction,
  emptyPiCompactionUsage,
  failStagedCompaction,
  type HostCompactionCandidate,
  type PiCompactionResult,
} from "./compaction-ack.js";

export type { HostCompactionCandidate, PiCompactionResult };

export interface CompactionPreparation {
  tokensBefore: number;
  firstKeptEntryId: string;
  retainedTail?: unknown[];
  messagesToSummarize?: unknown[];
  turnPrefixMessages?: unknown[];
  branchScope?: string;
  head?: string;
  directives?: Array<{ directiveId: string; quote: string }>;
  allow?: boolean;
}

export type CandidateResult =
  | { kind: "ready"; candidate: HostCompactionCandidate }
  | { kind: "rejected"; code: string };

export interface CompactionEvent {
  preparation: CompactionPreparation;
  reason: "threshold" | "overflow" | "manual";
  compactionEntry?: PiCompactionResult;
}

export type CompactionDecision =
  | { kind: "pcr"; result: PiCompactionResult }
  | { kind: "native-fallback" }
  | { kind: "hard-stop"; code: string };

export interface CompactionRuntime {
  prepareCompaction(event: CompactionEvent, ctx: ContextHookCtx): Promise<CompactionDecision>;
  stageCompaction(result: PiCompactionResult, ctx: ContextHookCtx): Promise<void>;
  ackHostCompaction(entry: PiCompactionResult | undefined, ctx: ContextHookCtx): Promise<void>;
  failStagedCompaction(event: CompactionEvent, ctx: ContextHookCtx): Promise<void>;
}

export interface CompactionExtensionAPI {
  on(
    hook: string,
    handler: (event: CompactionEvent, ctx: ContextHookCtx) => Promise<unknown>,
  ): void;
}

export function toPiCompactionResult(candidate: HostCompactionCandidate): PiCompactionResult {
  return {
    firstKeptEntryId: candidate.firstKeptEntryId,
    summary: candidate.summary,
    tokensBefore: candidate.tokensBefore,
    estimatedTokensAfter: candidate.estimatedTokensAfter,
    fromExtension: true,
    details: candidate.details,
    usage: emptyPiCompactionUsage(),
  };
}

export function registerCompactionHooks(pi: CompactionExtensionAPI, runtime: CompactionRuntime): void {
  if (!pi || typeof pi.on !== "function") throw new TypeError("PCR_COMPACTION_HOOK_DEPENDENCY_MISSING");
  if (!runtime || typeof runtime.prepareCompaction !== "function") throw new TypeError("PCR_COMPACTION_HOOK_DEPENDENCY_MISSING");
  pi.on("session_before_compact", async (event, ctx) => {
    if (event.reason === "manual" && event.preparation.allow === false) {
      await runtime.failStagedCompaction(event, ctx);
      return { cancel: true };
    }
    const decision = await runtime.prepareCompaction(event, ctx);
    if (decision.kind === "native-fallback") return undefined;
    if (decision.kind === "hard-stop") {
      ctx.abort();
      return { cancel: true };
    }
    await runtime.stageCompaction(decision.result, ctx);
    return { compaction: decision.result };
  });
  pi.on("session_compact", async (event, ctx) => {
    await runtime.ackHostCompaction(event.compactionEntry, ctx);
  });
  pi.on("session_compact_failed", async (event, ctx) => {
    await runtime.failStagedCompaction(event, ctx);
  });
}

export { ackHostCompaction, failStagedCompaction };
