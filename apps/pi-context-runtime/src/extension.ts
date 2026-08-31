import { createHash } from "node:crypto";
import { ackHostCompaction, emptyPiCompactionUsage, failStagedCompaction, type StagedCompaction } from "../../../packages/pi-adapter/src/compaction-ack.js";
import {
  registerCompactionHooks,
  type CompactionDecision,
  type CompactionExtensionAPI,
  type CompactionPreparation,
  type PiCompactionResult,
} from "../../../packages/pi-adapter/src/compaction-hook.js";
import {
  registerContextHook,
  type ExtensionAPI,
  type RuntimeSessionRegistry,
} from "../../../packages/pi-adapter/src/context-hook.js";
import { isHardBackgroundPath, registerBackgroundHook } from "../../../packages/pi-adapter/src/background-hook.js";
import { registerRuntimeTools } from "../../../packages/pi-adapter/src/commands/context.js";
import { createLifecycleRuntimeFromRecovery, registerSessionLifecycle } from "../../../packages/pi-adapter/src/lifecycle.js";
import { blobId, domainHash, type DirectiveRecord, type RuntimeCursor } from "../../../packages/contracts/src/index.js";
import { createTokenPricer } from "../../../packages/core/src/budget/pricer.js";
import { createCheckpointRenderer, createCheckpointVerifier } from "../../../packages/core/src/compaction/checkpoint.js";
import { emptyContinuityRevision } from "../../../packages/core/src/continuity/reduce.js";
import { createDirectiveExtractor } from "../../../packages/core/src/directives/extract.js";
import { createClauseSegmenter } from "../../../packages/core/src/directives/segment.js";
import { toDirectiveRecord } from "../../../packages/core/src/directives/temporal.js";
import { createRuntimeCursor } from "../../../packages/core/src/identity/stable-identity.js";
import { createCacheReceipt, type CacheReceiptRecord } from "../../../packages/core/src/materialization/cache.js";
import { createMaterializer } from "../../../packages/core/src/materialization/materializer.js";
import { createSectionPlanner } from "../../../packages/core/src/materialization/sections.js";
import {
  createCompactionService,
  createCompactionSnapshotAssembler,
  createRecoveryService,
} from "../../../packages/runtime/src/index.js";
import { candidateKey, CandidateWorker, type CandidateSnapshot } from "../../../packages/worker/src/candidate-worker.js";
import { registerOperationsCommands } from "./commands/operations.js";
import { fixtureEnvironment, runRuntimeDoctor } from "./doctor.js";
import { claimPiContextOwner } from "./owner.js";
import { captureUserDirectives } from "../../../packages/kernel/src/directives/capture.js";
import { derivePiSessionContext, registerProductionUserTurnRuntime, type PiRuntimeContext } from "./composition-root.js";

export interface ExtensionFactoryOptions {
  claimOnCreate?: boolean;
}

export interface HostExtensionAPI extends ExtensionAPI {
  registerTool: (tool: { name: string }) => void;
  registerCommand: (name: string, spec: { description: string; handler: unknown }) => void;
  hasTool?: (name: string) => boolean;
}

export interface PiContextExtension {
  name: "pi-context-runtime";
  hooks: Record<string, unknown>;
  claimed: boolean;
  release?: () => void | Promise<void>;
}

function isHostExtensionAPI(value: unknown): value is HostExtensionAPI {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as HostExtensionAPI).on === "function" &&
    typeof (value as HostExtensionAPI).registerTool === "function"
  );
}

export function createPiContextExtension(pi: HostExtensionAPI): PiContextExtension;
export function createPiContextExtension(options?: ExtensionFactoryOptions): PiContextExtension;
export function createPiContextExtension(
  optionsOrPi: ExtensionFactoryOptions | HostExtensionAPI = {},
): PiContextExtension {
  if (isHostExtensionAPI(optionsOrPi)) {
    return bindClaimedRuntime(optionsOrPi);
  }
  if (!optionsOrPi.claimOnCreate) {
    return { name: "pi-context-runtime", hooks: {}, claimed: false };
  }
  const hooks: Record<string, unknown> = {};
  const registeredToolNames = new Set<string>();
  const pi: HostExtensionAPI = {
    on(hook, handler) {
      hooks[hook] = handler;
    },
    registerTool(tool) {
      if (registeredToolNames.has(tool.name)) throw new Error(`tool name collision: ${tool.name}`);
      registeredToolNames.add(tool.name);
    },
    registerCommand() {},
    hasTool(name) {
      return registeredToolNames.has(name);
    },
  };
  return { ...bindClaimedRuntime(pi), hooks };
}

/** Pi package factory: `export default function (pi: ExtensionAPI)`. */
export function register(pi: HostExtensionAPI): PiContextExtension {
  return createPiContextExtension(pi);
}

function messageText(message: unknown): string {
  if (!message || typeof message !== "object" || !("content" in message)) return "";
  const content = message.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (typeof block === "string") return block;
      if (block && typeof block === "object" && "text" in block) return String(block.text ?? "");
      return "";
    })
    .join("\n");
}

function directivesFromPreparation(preparation: {
  directives?: Array<{ directiveId: string; quote: string }>;
  messagesToSummarize?: unknown[];
}): Array<{ directiveId: string; quote: string }> {
  if (preparation.directives && preparation.directives.length > 0) return preparation.directives;
  const found: Array<{ directiveId: string; quote: string }> = [];
  for (const [index, message] of (preparation.messagesToSummarize ?? []).entries()) {
    const role = message && typeof message === "object" && "role" in message ? String(message.role) : "";
    if (role !== "user") continue;
    for (const item of captureUserDirectives({
      sourceClass: "authenticated-user",
      text: messageText(message),
      messageId: `prep_${index}`,
    })) {
      found.push({ directiveId: item.directiveId, quote: item.quote });
    }
  }
  return found;
}

function sessionCursor(ctx: {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
}): RuntimeCursor {
  return {
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    leafId: ctx.leafId,
    lineageHash: ctx.lineageHash,
    modelKey: ctx.modelKey,
  };
}

function directiveRecordsFromPreparation(cursor: RuntimeCursor, preparation: CompactionPreparation): DirectiveRecord[] {
  const texts: string[] = [];
  for (const item of preparation.directives ?? []) {
    if (typeof item.quote === "string" && item.quote.length > 0) texts.push(item.quote);
  }
  for (const message of preparation.messagesToSummarize ?? []) {
    const role = message && typeof message === "object" && "role" in message ? String(message.role) : "";
    if (role !== "user") continue;
    const text = messageText(message);
    if (text.length > 0) texts.push(text);
  }
  const extractor = createDirectiveExtractor({ cursor });
  const segmenter = createClauseSegmenter({ cursor });
  const records: DirectiveRecord[] = [];
  for (const [index, text] of texts.entries()) {
    const bytes = Buffer.from(text, "utf8");
    const turn = {
      userTurnId: `user_turn_${domainHash("prep-turn", { index, text }).slice(0, 12)}`,
      cursor,
      rawTextHash: createHash("sha256").update(bytes).digest("hex"),
      rawBlobId: blobId(`blob_${domainHash("prep-blob", text)}`),
      utf8Bytes: bytes.byteLength,
      hostMessageId: `prep_${index}`,
      sourceClass: "authenticated-user" as const,
      capturedAt: index + 1,
    };
    for (const candidate of extractor.extract(turn, segmenter.segment({ text, cursor }))) {
      const stored = toDirectiveRecord(candidate);
      const { cursor: _cursor, ...record } = stored;
      records.push(record);
    }
  }
  return records;
}

function toPiDecision(decision: Awaited<ReturnType<ReturnType<typeof createCompactionService>["prepareCompaction"]>>): CompactionDecision {
  if (decision.kind !== "pcr") return decision;
  const result: PiCompactionResult = {
    firstKeptEntryId: decision.result.firstKeptEntryId,
    summary: decision.result.summary,
    tokensBefore: decision.result.tokensBefore,
    estimatedTokensAfter: decision.result.estimatedTokensAfter,
    fromExtension: true,
    details: decision.result.details,
    usage: emptyPiCompactionUsage(),
  };
  return { kind: "pcr", result };
}

function createProductCompactionService(cursor: RuntimeCursor, preparation: CompactionPreparation) {
  const records = directiveRecordsFromPreparation(cursor, preparation);
  return createCompactionService({
    cursor,
    assembler: createCompactionSnapshotAssembler({
      cursor,
      transaction: { async run(work) { return work(); } },
      directives: { async active() { return records; } },
      continuity: { async current() { return emptyContinuityRevision(cursor); } },
      claims: {
        async list() {
          return records
            .filter((item) => item.key && item.value !== undefined)
            .map((item) => ({
              claimId: `cl_${item.directiveId}`,
              key: item.key as string,
              polarity: item.polarity,
              status: item.status,
              value: item.value,
            }));
        },
      },
      evidence: { async pointers() { return []; } },
    }),
    renderer: createCheckpointRenderer({ cursor }),
    verifier: createCheckpointVerifier({
      cursor,
      pointers: { async verify() {} },
    }),
  });
}

function createExtensionContextRegistry(): RuntimeSessionRegistry {
  return {
    async open(ctx) {
      const cursor = sessionCursor(ctx);
      const route = {
        modelKey: cursor.modelKey,
        contextWindow: 200192,
        maxOutputTokens: 16384,
        providerReservedTokens: 0,
      };
      const pricer = createTokenPricer({ cursor, routes: { [cursor.modelKey]: route } });
      const rows: CacheReceiptRecord[] = [];
      const materializer = createMaterializer({
        cursor,
        pricer,
        planner: createSectionPlanner({ cursor, pricer }),
        cache: createCacheReceipt({
          cursor,
          store: {
            async put(receipt) { rows.push(receipt); },
            async head() {
              return [...rows].reverse().find((row) => (
                row.cursor.workspaceId === cursor.workspaceId
                && row.cursor.sessionId === cursor.sessionId
                && row.cursor.leafId === cursor.leafId
                && row.cursor.lineageHash === cursor.lineageHash
                && row.cursor.modelKey === cursor.modelKey
              )) ?? null;
            },
          },
        }),
      });
      return {
        async materialize(request) {
          return materializer.materialize({
            cursor: request.cursor,
            canonicalMessages: request.canonicalMessages,
            currentContextWindow: request.currentContextWindow,
            maxOutputTokens: request.maxOutputTokens,
            reason: request.reason,
            now: request.now,
            signal: request.signal,
          }, {
            cursor,
            directives: request.canonicalMessages.filter((message) => message.role === "user"),
            continuity: [],
          });
        },
      };
    },
  };
}

function bindClaimedRuntime(pi: HostExtensionAPI): PiContextExtension {
  const owner = claimPiContextOwner("pi-context-runtime");
  const userTurns = registerProductionUserTurnRuntime(pi as never);
  const identity = { create: createRuntimeCursor };
  const hookRegistry = createExtensionContextRegistry();
  registerContextHook({
    on(hook, handler) {
      pi.on(hook, async (event, ctx) => {
        if (hook !== "context") return handler(event, ctx);
        let derived;
        try {
          derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
        } catch {
          return { messages: event.messages };
        }
        const host = ctx && typeof ctx === "object"
          ? ctx as PiRuntimeContext & { abort?: () => void; now?: number; model?: { contextWindow?: number; maxTokens?: number } }
          : undefined;
        return handler(event, {
          abort: () => {
            if (typeof host?.abort === "function") host.abort();
          },
          signal: host?.signal,
          workspaceId: derived.workspaceId,
          sessionId: derived.sessionId,
          leafId: derived.leafId,
          lineageHash: derived.lineageHash,
          modelKey: derived.modelKey,
          now: typeof host?.now === "number" && Number.isFinite(host.now) ? host.now : 0,
          currentContextWindow: host?.model?.contextWindow,
          maxOutputTokens: host?.model?.maxTokens,
        });
      });
    },
  }, hookRegistry);
  let staged: StagedCompaction | null = null;
  registerCompactionHooks(pi as unknown as CompactionExtensionAPI, {
    async prepareCompaction(event, ctx) {
      try {
        let cursor: RuntimeCursor;
        try {
          const derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
          cursor = sessionCursor(derived);
        } catch {
          const cwd = ctx && typeof ctx === "object" && "cwd" in ctx && typeof ctx.cwd === "string" && ctx.cwd.length > 0
            ? ctx.cwd
            : process.cwd();
          const modelKey = ctx && typeof ctx === "object" && "model" in ctx && ctx.model && typeof ctx.model === "object" && "id" in ctx.model
            ? String(ctx.model.id)
            : "unbound";
          cursor = createRuntimeCursor({
            workspacePath: cwd,
            sessionId: "unbound",
            leafId: null,
            lineageEntryIds: ["unbound"],
            modelKey,
          });
        }
        const service = createProductCompactionService(cursor, event.preparation);
        const decision = await service.prepareCompaction({
          operationId: "op_compact",
          cursor,
          reason: event.reason,
          now: Date.now(),
          tokensBefore: event.preparation.tokensBefore,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          signal: ctx.signal,
        });
        return toPiDecision(decision);
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
        return { kind: "native-fallback" };
      }
    },
    async stageCompaction(result) {
      staged = {
        candidate: {
          firstKeptEntryId: result.firstKeptEntryId,
          summary: result.summary,
          tokensBefore: result.tokensBefore,
          estimatedTokensAfter: result.estimatedTokensAfter,
          details: result.details,
        },
        result,
      };
    },
    async ackHostCompaction(entry) {
      ackHostCompaction(staged, entry, () => {
        staged = null;
      });
    },
    async failStagedCompaction() {
      failStagedCompaction(staged, () => {
        staged = null;
      });
    },
  });
  let lastRecoveredCursor: RuntimeCursor | undefined;
  let recovery: ReturnType<typeof createRecoveryService> | undefined;
  const fenceKeys = new Set<string>();
  function recoveryFor(cursor: RuntimeCursor) {
    recovery ??= createRecoveryService({
      cursor,
      sessions: {
        async open(ctx) {
          lastRecoveredCursor = sessionCursor(ctx);
        },
        async close() {},
      },
      journal: { async reconcile() { return { actions: [] }; } },
      candidates: {
        async invalidate(scope, reason) {
          const key = `${scope.sessionId}:${scope.lineageHash}:${reason}`;
          if (fenceKeys.has(key)) return 0;
          fenceKeys.add(key);
          return 1;
        },
      },
    });
    return recovery;
  }
  registerSessionLifecycle(pi as never, createLifecycleRuntimeFromRecovery({
    recovery: {
      onSessionStart: (input) => recoveryFor(input.cursor).onSessionStart(input),
      onBranchChange: (input) => recoveryFor(input.cursor).onBranchChange(input),
      onSessionClose: (input) => recoveryFor(input.cursor).onSessionClose(input),
    },
    cursorFrom(ctx) {
      try {
        return sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      } catch {
        const cwd = typeof ctx.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
        const sessionId = ctx.sessionManager?.getSessionId() || ctx.sessionId || "unbound";
        const leafId = ctx.sessionManager?.getLeafId() ?? null;
        const branchIds = ctx.sessionManager?.getBranch().map((entry) => entry.id) ?? [];
        const headerId = ctx.sessionManager?.getHeader()?.id;
        const lineageEntryIds = branchIds.length > 0 ? branchIds : headerId ? [headerId] : leafId ? [leafId] : ["unbound"];
        const modelKey = ctx.model?.provider && ctx.model.id
          ? `${ctx.model.provider}/${ctx.model.id}`
          : ctx.model?.id ?? "unbound";
        return createRuntimeCursor({
          workspacePath: cwd,
          sessionId,
          leafId,
          lineageEntryIds,
          modelKey,
        });
      }
    },
  }));
  let worker: CandidateWorker | undefined;
  const backgroundSnapshot = (): CandidateSnapshot => {
    const cursor = lastRecoveredCursor ?? createRuntimeCursor({
      workspacePath: process.cwd(),
      sessionId: "unbound",
      leafId: null,
      lineageEntryIds: ["unbound"],
      modelKey: "unbound",
    });
    return {
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      leafId: cursor.leafId ?? "header",
      lineageHash: cursor.lineageHash,
      sourceHead: "src_runtime",
      modelKey: cursor.modelKey,
      thinkingLevel: "off",
      contextWindow: 128000,
      systemPromptHash: "sys_runtime",
      activeToolSetHash: "tools_runtime",
      reducerRevisionSet: "red_runtime",
      extractorRevision: "ext_runtime",
      schemaVersion: "1",
      configFingerprint: "cfg_runtime",
    };
  };
  registerBackgroundHook(pi as never, {
    isHardPath: isHardBackgroundPath,
    snapshot: backgroundSnapshot,
    get worker() {
      worker ??= new CandidateWorker({
        store: {
          async findCandidate() {
            return undefined;
          },
          async markPreparing(key) {
            return { id: `c_${key.slice(0, 8)}`, key, phase: "preparing" };
          },
          async markPrepared(prepared) {
            return { ...prepared, phase: "prepared" };
          },
          async markStale(id, reason) {
            return { id, key: id, phase: "stale", reason };
          },
          async markCancelled(id) {
            return { id, key: id, phase: "cancelled" };
          },
          async markFailed(id, reason) {
            return { id, key: id, phase: "failed", reason };
          },
        },
        snapshotProvider: { current: backgroundSnapshot },
        async prepare(snapshot, signal) {
          if (signal.aborted) throw new Error("aborted");
          return { id: `prep_${snapshot.leafId}`, key: candidateKey(snapshot) };
        },
      });
      return worker;
    },
  });
  const deferredEvidence = {
    async admit() {
      throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
    },
    async search() {
      throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
    },
    async read() {
      throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
    },
  };
  registerRuntimeTools(pi, {
    workspaceId: userTurns.lastWorkspaceId() ?? "unbound",
    cursor: {
      workspaceId: `ws_${"0".repeat(40)}`,
      sessionId: "unbound",
      leafId: null,
      lineageHash: "0".repeat(64),
      modelKey: "unbound",
    },
    evidence: deferredEvidence,
    claimed: true,
    resolve: (ctx) => userTurns.resolveTools(ctx),
    commands: {
      status: async (ctx) => {
        try {
          const bound = await userTurns.resolveTools(ctx);
          return JSON.stringify({ ok: true, command: "context", workspaceId: bound.cursor.workspaceId, claimed: true });
        } catch {
          return JSON.stringify({ ok: false, command: "context", code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
        }
      },
      doctor: async (ctx) => {
        const workspaceId = (await userTurns.resolveTools(ctx).catch(() => undefined))?.cursor.workspaceId
          ?? userTurns.lastWorkspaceId()
          ?? ctx.workspaceId
          ?? "unbound";
        return JSON.stringify({
          command: "context-doctor",
          workspaceId,
          ...(await runRuntimeDoctor(
            fixtureEnvironment({
              nodeVersion: process.versions.node,
              piVersion: "0.84.4",
              packages: [],
              trusted: true,
            }),
            { conflictPolicy: "strict" },
          )),
        });
      },
      compact: async (ctx) => {
        try {
          const bound = await userTurns.resolveTools(ctx);
          return JSON.stringify({ ok: true, command: "context-compact", workspaceId: bound.cursor.workspaceId });
        } catch {
          return JSON.stringify({ ok: false, command: "context-compact", code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
        }
      },
    },
  });
  registerOperationsCommands(pi, {
    get workspaceId() {
      return userTurns.lastWorkspaceId() ?? "unbound";
    },
  });
  return {
    name: "pi-context-runtime",
    hooks: {},
    claimed: true,
    async release() {
      owner.release();
      await userTurns.close();
    },
  };
}

export default createPiContextExtension;
