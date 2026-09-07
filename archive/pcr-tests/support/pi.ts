import { buildDeterministicCheckpointCandidate } from "../../packages/kernel/src/compaction/candidate.js";
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
} from "../../packages/pi-adapter/src/context-hook.js";
import { catchUpSession, type CatchUpResult, type SessionStartReason } from "../../packages/kernel/src/lifecycle/catch-up.js";
import { switchBranchScope } from "../../packages/kernel/src/lifecycle/branch-scope.js";
import { registerSessionLifecycle, type LifecycleEvent } from "../../packages/pi-adapter/src/lifecycle.js";
import { toHostMessages, toPiMessages, type PiAgentMessage } from "../../packages/pi-adapter/src/message-conversion.js";
import {
  createCacheReceipt,
  createMaterializer,
  createRuntimeCursor,
  createSectionPlanner,
  createTokenPricer,
  type CacheReceiptRecord,
} from "../../packages/core/src/index.js";
import { createRuntimeSessionRegistry } from "../../packages/runtime/src/index.js";

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
  runtimeCursor: { branchScope: string; lineageHash: string; sessionId: string };
  previousBranchScope: string;
  continuity: { externalSideEffects: Array<{ id: string; status: string }> };
  workerOpen: boolean;
  closedPreviousWorker: boolean;
  catchUp?: CatchUpResult;
  navigateTree(leafId: string): Promise<void>;
  startSession(reason: SessionStartReason, hasRawBlobs?: boolean): Promise<void>;
  shutdown(): Promise<void>;
}

export async function createPiHarnessWithRuntime(
  options: { materializeError?: string; throwUnhandled?: boolean; existingSideEffect?: string } = {},
): Promise<HarnessHost> {
  let abortCalls = 0;
  let handler: ((event: { messages: PiAgentMessage[] }, ctx: ContextHookCtx) => Promise<{ messages: PiAgentMessage[] }>) | undefined;
  const events: string[] = [];
  const handlers: Record<string, (event: CompactionEvent, ctx: ContextHookCtx) => Promise<unknown>> = {};
  const lifeHandlers: Record<string, (event: LifecycleEvent, ctx: { sessionId?: string }) => Promise<unknown>> = {};
  let branchScope = "branch:leaf-a";
  let lineageHash = switchBranchScope({ currentScope: "boot", currentLineage: "", newLeafId: "leaf-a" }).lineageHash;
  let previousBranchScope = branchScope;
  let workerOpen = true;
  let closedPreviousWorker = false;
  let catchUp: CatchUpResult | undefined;
  const continuity = {
    externalSideEffects: options.existingSideEffect ? [{ id: options.existingSideEffect, status: "running-unverified" }] : [],
  };
  let staged: StagedCompaction | null = null;
  let lastCompaction: PiCompactionResult | undefined;
  const pi: ExtensionAPI & CompactionExtensionAPI = {
    on(hook, next) {
      if (hook === "context") handler = next as typeof handler;
      else if (hook === "session_start" || hook === "session_tree" || hook === "session_shutdown" || hook === "model_select") {
        lifeHandlers[hook] = next as (event: LifecycleEvent, ctx: { sessionId?: string }) => Promise<unknown>;
      } else handlers[hook] = next as (event: CompactionEvent, ctx: ContextHookCtx) => Promise<unknown>;
    },
  };
  const bound = createRuntimeCursor({
    workspacePath: "/tmp/pcr-harness-context",
    sessionId: "session-harness",
    leafId: "leaf-harness",
    lineageEntryIds: ["root", "leaf-harness"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
  const hookRows: CacheReceiptRecord[] = [];
  const pricer = createTokenPricer({
    cursor: bound,
    routes: {
      "openclaw/Qwen3.8-27B-WORK": {
        modelKey: "openclaw/Qwen3.8-27B-WORK",
        contextWindow: 8000,
        maxOutputTokens: 1000,
        providerReservedTokens: 0,
      },
    },
  });
  const t27 = createMaterializer({
    cursor: bound,
    pricer,
    planner: createSectionPlanner({ cursor: bound, pricer }),
    cache: createCacheReceipt({
      cursor: bound,
      store: {
        async put(receipt) { hookRows.push(receipt); },
        async head() { return hookRows.at(-1) ?? null; },
      },
    }),
  });
  const registry = createRuntimeSessionRegistry({
    workspaceId: bound.workspaceId,
    factory: {
      async create() {
        return {
          session: {
            async ingestUserInput() { throw new Error("unused"); },
            async ingestToolResult() { throw new Error("unused"); },
            async materialize(request) {
              if (options.materializeError) {
                throw Object.assign(new Error(options.materializeError), { code: options.materializeError });
              }
              return t27.materialize({
                cursor: request.cursor,
                canonicalMessages: request.canonicalMessages,
                currentContextWindow: request.currentContextWindow,
                maxOutputTokens: request.maxOutputTokens,
                reason: request.reason,
                now: request.now,
                signal: request.signal,
              }, { cursor: bound, directives: [], continuity: [] });
            },
          },
          dispose: async () => undefined,
        };
      },
    },
  });
  registerContextHook(pi, registry);
  registerCompactionHooks(pi, {
    async prepareCompaction(event) {
      const result = await buildDeterministicCheckpointCandidate(
        {
          tokensBefore: event.preparation.tokensBefore,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          retainedTail: event.preparation.retainedTail as never,
          branchScope: event.preparation.branchScope ?? "main",
          head: event.preparation.head ?? "leaf-a",
          directives: event.preparation.directives ?? [{ directiveId: "dir_keep", quote: "do not deploy prod" }],
          reason: event.reason,
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
          waitForSemantic: event.reason === "overflow",
          counter: {
            countText: (text) => Math.ceil(text.length / 4),
            countMessages: (messages) => messages.length * 10,
          },
        },
      );
      if (result.kind !== "ready") return { kind: "native-fallback" };
      return { kind: "pcr", result: toPiCompactionResult(result.candidate) };
    },
    async stageCompaction(result) {
      staged = { candidate: result, result };
      events.push("host-compaction-written");
    },
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
  registerSessionLifecycle(pi, {
    async openSession(_ctx, reason, hasRawBlobs = true) {
      workerOpen = true;
      catchUp = catchUpSession({ reason, hasRawBlobs });
    },
    async switchBranch(_ctx, newLeafId) {
      const next = switchBranchScope({ currentScope: branchScope, currentLineage: lineageHash, newLeafId });
      previousBranchScope = next.previousBranchScope;
      branchScope = next.branchScope;
      lineageHash = next.lineageHash;
      closedPreviousWorker = true;
      workerOpen = true;
      for (const effect of continuity.externalSideEffects) effect.status = "requires-revalidation";
    },
    async closeSession() {
      workerOpen = false;
    },
    async invalidateRouteCandidates() {
      catchUp = catchUp ? { ...catchUp, degraded: true } : catchUp;
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
    get runtimeCursor() {
      return { branchScope, lineageHash, sessionId: "s1" };
    },
    get previousBranchScope() {
      return previousBranchScope;
    },
    continuity,
    get workerOpen() {
      return workerOpen;
    },
    get closedPreviousWorker() {
      return closedPreviousWorker;
    },
    get catchUp() {
      return catchUp;
    },
    async navigateTree(leafId) {
      await lifeHandlers.session_tree?.({ newLeafId: leafId }, { sessionId: "s1" });
    },
    async startSession(reason, hasRawBlobs = true) {
      await lifeHandlers.session_start?.({ reason, hasRawBlobs }, { sessionId: "s1" });
    },
    async shutdown() {
      await lifeHandlers.session_shutdown?.({}, { sessionId: "s1" });
    },
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
        model: { id: bound.modelKey },
        workspaceId: bound.workspaceId,
        sessionId: bound.sessionId,
        leafId: bound.leafId,
        lineageHash: bound.lineageHash,
        modelKey: bound.modelKey,
        now: 1,
        currentContextWindow: 8000,
        maxOutputTokens: 1000,
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
