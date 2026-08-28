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

export interface CompactionRuntime {
  buildCheckpoint(
    preparation: CompactionEvent["preparation"],
    reason: CompactionEvent["reason"],
    ctx: ContextHookCtx,
  ): Promise<CandidateResult>;
  stageCompaction(candidate: HostCompactionCandidate, ctx: ContextHookCtx): Promise<void>;
  toPiCompactionResult(candidate: HostCompactionCandidate): PiCompactionResult;
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
  pi.on("session_before_compact", async (event, ctx) => {
    if (event.reason === "manual" && event.preparation.allow === false) {
      await runtime.failStagedCompaction(event, ctx);
      return { cancel: true };
    }
    const candidate = await runtime.buildCheckpoint(event.preparation, event.reason, ctx);
    if (candidate.kind !== "ready") return { cancel: true };
    await runtime.stageCompaction(candidate.candidate, ctx);
    return { compaction: runtime.toPiCompactionResult(candidate.candidate) };
  });
  pi.on("session_compact", async (event, ctx) => {
    await runtime.ackHostCompaction(event.compactionEntry, ctx);
  });
  pi.on("session_compact_failed", async (event, ctx) => {
    await runtime.failStagedCompaction(event, ctx);
  });
}

export { ackHostCompaction, failStagedCompaction };
