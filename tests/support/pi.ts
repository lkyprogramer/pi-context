import { buildDeterministicCheckpointCandidate } from "../../packages/kernel/src/compaction/candidate.js";
import { ContextMaterializer } from "../../packages/kernel/src/materialization/materializer.js";
import { ackHostCompaction as commitStaged, failStagedCompaction as clearStaged, type PiCompactionResult, type StagedCompaction } from "../../packages/pi-adapter/src/compaction-ack.js";
import {
  registerCompactionHooks,
  toPiCompactionResult,
  type CompactionEvent,
  type CompactionExtensionAPI,
} from "../../packages/pi-adapter/src/compaction-hook.js";
import {
  defaultSafeDiagnostic,
  registerContextHook,
  type ContextHookCtx,
  type ExtensionAPI,
  type PiRuntime,
} from "../../packages/pi-adapter/src/context-hook.js";
import { toHostMessages, toPiMessages, type PiAgentMessage } from "../../packages/pi-adapter/src/message-conversion.js";

export interface HarnessHost {
  abortCalls: number;
  events: string[];
  lastCompaction?: PiCompactionResult;
  lastPath?: "deterministic";
  emitContext(messages: PiAgentMessage[]): Promise<PiAgentMessage[]>;
  compact(
    reason: CompactionEvent["reason"],
    opts?: { cancel?: boolean; reuseStale?: boolean; allowManual?: boolean },
  ): Promise<void>;
  indexOf(name: string): number;
}

export async function createPiHarnessWithRuntime(
  options: { materializeError?: string; throwUnhandled?: boolean } = {},
): Promise<HarnessHost> {
  let abortCalls = 0;
  let handler: ((event: { messages: PiAgentMessage[] }, ctx: ContextHookCtx) => Promise<{ messages: PiAgentMessage[] }>) | undefined;
  const events: string[] = [];
  const handlers: Record<string, (event: CompactionEvent, ctx: ContextHookCtx) => Promise<unknown>> = {};
  let staged: StagedCompaction | null = null;
  let lastCompaction: PiCompactionResult | undefined;
  const pi: ExtensionAPI & CompactionExtensionAPI = {
    on(hook, next) {
      if (hook === "context") handler = next as typeof handler;
      else handlers[hook] = next as (event: CompactionEvent, ctx: ContextHookCtx) => Promise<unknown>;
    },
  };
  const materializer = new ContextMaterializer({ directives: "keep" });
  const runtime: PiRuntime = {
    kernel: {
      async materialize(input) {
        if (options.materializeError) {
          throw Object.assign(new Error(options.materializeError), { code: options.materializeError });
        }
        return materializer.materialize(input);
      },
    },
    async buildMaterializationInput(messages, ctx) {
      return {
        cursor: {
          workspaceId: "ws_0123456789abcdef",
          sessionId: "s1",
          leafId: null,
          lineageHash: "1111111111111111111111111111111111111111111111111111111111111111",
          modelKey: ctx.model?.id ?? "test",
          thinkingLevel: ctx.thinkingLevel ?? "off",
        },
        canonicalMessages: toHostMessages(messages),
        currentContextWindow: 8000,
        maxOutputTokens: 1000,
        reason: "normal",
        now: 1,
      };
    },
    async stageViewReceipt() {},
    converter: { toPi: toPiMessages },
    safeDiagnostic: defaultSafeDiagnostic,
    deterministicFallback: (messages) => messages,
  };
  registerContextHook(pi, runtime);
  registerCompactionHooks(pi, {
    async buildCheckpoint(preparation, reason) {
      const result = await buildDeterministicCheckpointCandidate(
        {
          tokensBefore: preparation.tokensBefore,
          firstKeptEntryId: preparation.firstKeptEntryId,
          retainedTail: preparation.retainedTail,
          branchScope: preparation.branchScope ?? "main",
          head: preparation.head ?? "leaf-a",
          directives: preparation.directives ?? [{ directiveId: "dir_keep", quote: "do not deploy prod" }],
          reason,
        },
        {
          checkpoint: {
            directives: [{ directiveId: "dir_keep", quote: "do not deploy prod", polarity: "must-not", status: "active" }],
            continuity: { revisionId: "cr_aaaaaaaa" },
            claims: [],
            pointers: [{ ref: "blob_ok", kind: "raw-blob" }],
            heads: {
              contextHead: "ctx_aaaaaaaa",
              directiveHead: "dh_1",
              claimHead: "ch_1",
              continuityHead: "cth_1",
              catalogHead: "cah_1",
            },
          },
          verifiedPointers: new Set(["blob_ok"]),
          branchScope: "main",
          head: "leaf-a",
          waitForSemantic: reason === "overflow",
          counter: {
            countText: (text) => Math.ceil(text.length / 4),
            countMessages: (messages) => messages.length * 10,
          },
        },
      );
      return result;
    },
    async stageCompaction(candidate) {
      const mapped = toPiCompactionResult(candidate);
      staged = { candidate, result: mapped };
      events.push("host-compaction-written");
    },
    toPiCompactionResult,
    async ackHostCompaction(entry) {
      commitStaged(staged, entry, () => {
        events.push("runtime-generation-committed");
      });
    },
    async failStagedCompaction() {
      clearStaged(staged, () => {
        staged = null;
      });
    },
  });
  const ctx: ContextHookCtx = {
    abort() {
      abortCalls += 1;
    },
    model: { id: "test" },
  };
  return {
    get abortCalls() {
      return abortCalls;
    },
    set abortCalls(value) {
      abortCalls = value;
    },
    events,
    get lastCompaction() {
      return lastCompaction;
    },
    lastPath: "deterministic" as const,
    indexOf(name) {
      return events.indexOf(name);
    },
    async compact(reason, opts = {}) {
      events.push("session_before_compact");
      const before = handlers.session_before_compact;
      if (!before) throw new Error("session_before_compact handler missing");
      const result = (await before(
        {
          preparation: {
            tokensBefore: 500,
            firstKeptEntryId: "entry_tail",
            retainedTail: [],
            allow: opts.allowManual,
          },
          reason,
        },
        ctx,
      )) as { cancel?: boolean; compaction?: PiCompactionResult };
      if (result?.cancel || !result?.compaction) {
        events.push("session_compact_failed");
        await handlers.session_compact_failed?.({ preparation: { tokensBefore: 500, firstKeptEntryId: "entry_tail", retainedTail: [] }, reason }, ctx);
        return;
      }
      lastCompaction = result.compaction;
      if (opts.cancel) {
        events.push("session_compact_failed");
        await handlers.session_compact_failed?.({ preparation: { tokensBefore: 500, firstKeptEntryId: "entry_tail", retainedTail: [] }, reason, compactionEntry: result.compaction }, ctx);
        return;
      }
      events.push("session_compact");
      const entry = opts.reuseStale
        ? { ...result.compaction, details: { ...result.compaction.details, outputHash: "stale-hash" } }
        : result.compaction;
      await handlers.session_compact?.({ preparation: { tokensBefore: 500, firstKeptEntryId: "entry_tail", retainedTail: [] }, reason, compactionEntry: entry }, ctx);
    },
    async emitContext(messages) {
      const ctx: ContextHookCtx = {
        abort() {
          abortCalls += 1;
        },
        model: { id: "test" },
      };
      if (!handler) throw new Error("context handler missing");
      try {
        const result = await handler({ messages: messages.map((item) => ({ ...item })) }, ctx);
        return result.messages;
      } catch (error) {
        if (options.throwUnhandled) throw error;
        return defaultSafeDiagnostic(messages, { code: "PCR_HANDLER_ISOLATED", severity: "hard" });
      }
    },
  };
}

export { toHostMessages, toPiMessages };
