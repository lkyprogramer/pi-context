import { emptyPiCompactionUsage } from "../../../packages/pi-adapter/src/compaction-ack.js";
import {
  registerCompactionHooks,
  type CompactionDecision,
  type CompactionExtensionAPI,
  type PiCompactionResult,
} from "../../../packages/pi-adapter/src/compaction-hook.js";
import {
  registerContextHook,
  type ExtensionAPI,
} from "../../../packages/pi-adapter/src/context-hook.js";
import { isHardBackgroundPath, registerBackgroundHook } from "../../../packages/pi-adapter/src/background-hook.js";
import { registerRuntimeTools } from "../../../packages/pi-adapter/src/commands/context.js";
import { registerSessionLifecycle, toPcrSessionStartReason } from "../../../packages/pi-adapter/src/lifecycle.js";
import { domainHash, type HostCheckpointDetails, type RuntimeCursor } from "../../../packages/contracts/src/index.js";
import { createRuntimeCursor, estimateTextTokens } from "../../../packages/core/src/index.js";
import { collectCompactionSourceTexts, type SessionCompactionDecision } from "../../../packages/runtime/src/index.js";
import { candidateKey, CandidateWorker, type CandidateSnapshot } from "../../../packages/worker/src/candidate-worker.js";
import { registerOperationsCommands } from "./commands/operations.js";
import { REQUIRED_PI_CAPABILITIES } from "../../../packages/pi-adapter/src/capabilities.js";
import { runRuntimeDoctor } from "./doctor.js";
import { claimPiContextOwner } from "./owner.js";
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

function toPiDecision(decision: SessionCompactionDecision): CompactionDecision {
  if (decision.kind !== "pcr") return decision;
  const result: PiCompactionResult = {
    firstKeptEntryId: decision.result.firstKeptEntryId,
    summary: decision.result.summary,
    tokensBefore: decision.result.tokensBefore,
    estimatedTokensAfter: decision.result.estimatedTokensAfter,
    fromExtension: true,
    details: decision.result.details as HostCheckpointDetails,
    usage: emptyPiCompactionUsage(),
  };
  return { kind: "pcr", result };
}

function bindClaimedRuntime(pi: HostExtensionAPI): PiContextExtension {
  const owner = claimPiContextOwner("pi-context-runtime");
  const registeredTools: Array<{ name: string }> = [];
  const hostRegisterTool = pi.registerTool.bind(pi);
  pi.registerTool = ((tool: { name: string }) => {
    registeredTools.push({ name: tool.name });
    return hostRegisterTool(tool);
  }) as typeof pi.registerTool;
  const userTurns = registerProductionUserTurnRuntime(pi as never);
  const identity = { create: createRuntimeCursor };
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
        await userTurns.ensure(ctx as never);
        const host = ctx && typeof ctx === "object"
          ? ctx as PiRuntimeContext & {
            abort?: () => void;
            now?: number;
            model?: { contextWindow?: number; maxTokens?: number; providerReservedTokens?: number };
            getSystemPrompt?: () => string;
            getContextUsage?: () => { tokens?: number | null; contextWindow?: number } | undefined;
          }
          : undefined;
        const systemText = typeof host?.getSystemPrompt === "function" ? host.getSystemPrompt() : undefined;
        const toolsJson = JSON.stringify({ tools: registeredTools });
        const hostUsage = typeof host?.getContextUsage === "function" ? host.getContextUsage() : undefined;
        const providerUsage = hostUsage && typeof hostUsage.tokens === "number"
          ? { inputTokens: hostUsage.tokens }
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
          providerReservedTokens: typeof host?.model?.providerReservedTokens === "number"
            ? host.model.providerReservedTokens
            : 0,
          ...(systemText === undefined ? {} : { systemText }),
          toolsJson,
          ...(providerUsage === undefined ? {} : { providerUsage }),
        });
      });
    },
  }, {
    open: (sessionCtx) => userTurns.openSession(sessionCtx),
  });
  registerCompactionHooks(pi as unknown as CompactionExtensionAPI, {
    async prepareCompaction(event, ctx) {
      try {
        const derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
        await userTurns.ensure(ctx as never);
        const session = await userTurns.openSession(derived);
        const compact = session.prepareCompaction;
        if (typeof compact !== "function") return { kind: "native-fallback" };
        const sourceMessages = [
          ...(Array.isArray(event.preparation.messagesToSummarize) ? event.preparation.messagesToSummarize : []),
          ...(Array.isArray(event.preparation.turnPrefixMessages) ? event.preparation.turnPrefixMessages : []),
        ];
        const tailTexts = collectCompactionSourceTexts(event.preparation.retainedTail);
        const decision = await compact.call(session, {
          operationId: "op_compact",
          cursor: sessionCursor(derived),
          reason: event.reason,
          now: Date.now(),
          tokensBefore: event.preparation.tokensBefore,
          firstKeptEntryId: event.preparation.firstKeptEntryId,
          messagesToSummarize: sourceMessages,
          retainedTailTokens: tailTexts.length === 0
            ? undefined
            : tailTexts.reduce((sum, text) => sum + estimateTextTokens(text), 0),
          signal: ctx.signal,
        });
        return toPiDecision(decision);
      } catch (error) {
        if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
        return { kind: "native-fallback" };
      }
    },
    async stageCompaction(result, ctx) {
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      const pending = await userTurns.pendingCompaction(cursor);
      if (pending?.outputHash === result.details.outputHash && pending.firstKeptEntryId === result.firstKeptEntryId) {
        return;
      }
      await userTurns.stageCompaction({
        cursor,
        outputHash: result.details.outputHash,
        firstKeptEntryId: result.firstKeptEntryId,
        payloadJson: JSON.stringify(result),
      });
    },
    async ackHostCompaction(entry, ctx) {
      if (!entry) return;
      const derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
      await userTurns.ensure(ctx as never);
      const session = await userTurns.openSession(derived);
      const ack = session.acknowledgeCompaction;
      if (typeof ack !== "function") {
        throw Object.assign(new Error("PCR_COMPACTION_ACK_UNSUPPORTED"), { code: "PCR_COMPACTION_ACK_UNSUPPORTED" });
      }
      await ack.call(session, {
        operationId: "op_ack_compact",
        cursor: sessionCursor(derived),
        firstKeptEntryId: entry.firstKeptEntryId,
        outputHash: entry.details.outputHash,
      });
    },
    async failStagedCompaction(_event, ctx) {
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      await userTurns.failStagedCompaction(cursor);
    },
  });
  const cursorsBySession = new Map<string, RuntimeCursor>();
  const sessionKey = (cursor: RuntimeCursor) => `${cursor.workspaceId}:${cursor.sessionId}`;
  registerSessionLifecycle(pi as never, {
    async openSession(ctx, reason, hasRawBlobs = true) {
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      cursorsBySession.set(sessionKey(cursor), cursor);
      await userTurns.ensure(ctx as never);
      const report = await userTurns.recover({
        cursor,
        reason: toPcrSessionStartReason(reason),
        hasRawBlobs,
        signal: ctx.signal,
      });
      cursorsBySession.set(sessionKey(report.cursor), report.cursor);
      return report.cursor;
    },
    async switchBranch(ctx, newLeafId) {
      await userTurns.ensure(ctx as never);
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      const previous = cursorsBySession.get(sessionKey(cursor));
      if (!previous) {
        throw Object.assign(new Error("PCR_LIFECYCLE_PREVIOUS_CURSOR_MISSING"), {
          code: "PCR_LIFECYCLE_PREVIOUS_CURSOR_MISSING",
        });
      }
      await userTurns.branchChanged({ cursor, previousCursor: previous, newLeafId, signal: ctx.signal });
      cursorsBySession.set(sessionKey(cursor), cursor);
    },
    async closeSession(ctx) {
      const derived = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      const cursor = cursorsBySession.get(sessionKey(derived)) ?? derived;
      await userTurns.closeSession(cursor);
      cursorsBySession.delete(sessionKey(cursor));
    },
    async invalidateRouteCandidates() {},
  });
  const semanticBeta = process.env.PCR_SEMANTIC_BETA === "1";
  let worker: CandidateWorker | undefined;
  const backgroundSnapshot = (_event?: unknown, ctx?: unknown): CandidateSnapshot => {
    const derived = ctx
      ? sessionCursor(derivePiSessionContext(ctx as PiRuntimeContext, identity))
      : undefined;
    const cursor = derived && cursorsBySession.get(sessionKey(derived)) || derived;
    if (!cursor) {
      throw Object.assign(new Error("PCR_BACKGROUND_CURSOR_MISSING"), { code: "PCR_BACKGROUND_CURSOR_MISSING" });
    }
    return {
      workspaceId: cursor.workspaceId,
      sessionId: cursor.sessionId,
      leafId: cursor.leafId ?? "header",
      lineageHash: cursor.lineageHash,
      sourceHead: domainHash("session-source", cursor.lineageHash),
      modelKey: cursor.modelKey,
      thinkingLevel: "off",
      contextWindow: 128000,
      systemPromptHash: domainHash("session-system", { sessionId: cursor.sessionId, modelKey: cursor.modelKey }),
      activeToolSetHash: domainHash("session-tools", { sessionId: cursor.sessionId, modelKey: cursor.modelKey }),
      reducerRevisionSet: domainHash("session-reducer", cursor.lineageHash),
      extractorRevision: domainHash("session-extractor", cursor.lineageHash),
      schemaVersion: "1",
      configFingerprint: domainHash("session-config", {
        workspaceId: cursor.workspaceId,
        sessionId: cursor.sessionId,
        modelKey: cursor.modelKey,
      }),
    };
  };
  if (semanticBeta) registerBackgroundHook(pi as never, {
    isHardPath: isHardBackgroundPath,
    snapshot: backgroundSnapshot,
    get worker() {
      const memory = new Map<string, { id: string; key: string; phase: "preparing" | "prepared" | "stale" | "cancelled" | "failed"; reason?: string }>();
      worker ??= new CandidateWorker({
        store: {
          async findCandidate(key) {
            return memory.get(key);
          },
          async markPreparing(key) {
            const rec = { id: `c_${key.slice(0, 16)}`, key, phase: "preparing" as const };
            memory.set(key, rec);
            return rec;
          },
          async markPrepared(prepared) {
            const rec = { ...prepared, phase: "prepared" as const };
            memory.set(prepared.key, rec);
            const snap = backgroundSnapshot();
            await userTurns.persistBackgroundCandidate({
              workspaceId: snap.workspaceId,
              sessionId: snap.sessionId,
              leafId: snap.leafId === "header" ? null : snap.leafId,
              lineageHash: snap.lineageHash,
              modelKey: snap.modelKey,
              sourceHead: domainHash("source-head", snap.sourceHead),
              configFingerprint: domainHash("config", snap.configFingerprint),
            }).catch(() => undefined);
            return rec;
          },
          async markStale(id, reason) {
            const rec = [...memory.values()].find((row) => row.id === id) ?? { id, key: id, phase: "stale" as const, reason };
            const next = { ...rec, phase: "stale" as const, reason };
            memory.set(next.key, next);
            return next;
          },
          async markCancelled(id) {
            const rec = [...memory.values()].find((row) => row.id === id) ?? { id, key: id, phase: "cancelled" as const };
            const next = { ...rec, phase: "cancelled" as const };
            memory.set(next.key, next);
            return next;
          },
          async markFailed(id, reason) {
            const rec = [...memory.values()].find((row) => row.id === id) ?? { id, key: id, phase: "failed" as const, reason };
            const next = { ...rec, phase: "failed" as const, reason };
            memory.set(next.key, next);
            return next;
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
    get workspaceId() {
      const id = userTurns.lastWorkspaceId();
      if (!id) {
        throw Object.assign(new Error("PCR_RUNTIME_TOOLS_CURSOR_MISSING"), { code: "PCR_RUNTIME_TOOLS_CURSOR_MISSING" });
      }
      return id;
    },
    get cursor(): RuntimeCursor {
      throw Object.assign(new Error("PCR_RUNTIME_TOOLS_CURSOR_MISSING"), { code: "PCR_RUNTIME_TOOLS_CURSOR_MISSING" });
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
        const bound = await userTurns.resolveTools(ctx).catch(() => undefined);
        const workspaceId = bound?.cursor.workspaceId ?? userTurns.lastWorkspaceId() ?? ctx.workspaceId;
        if (!workspaceId) {
          throw Object.assign(new Error("PCR_RUNTIME_TOOLS_CURSOR_MISSING"), { code: "PCR_RUNTIME_TOOLS_CURSOR_MISSING" });
        }
        const dataRoot = typeof ctx.cwd === "string" && ctx.cwd.length > 0 ? ctx.cwd : process.cwd();
        return JSON.stringify({
          command: "context-doctor",
          workspaceId,
          ...(await runRuntimeDoctor(
            {
              packages: [],
              nodeVersion: process.versions.node,
              piVersion: "0.84.4",
              capabilities: REQUIRED_PI_CAPABILITIES.filter((name) => name !== "agent_settled" || semanticBeta),
              trusted: true,
              dataRoot,
            },
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
      const id = userTurns.lastWorkspaceId();
      if (!id) {
        throw Object.assign(new Error("PCR_RUNTIME_TOOLS_CURSOR_MISSING"), { code: "PCR_RUNTIME_TOOLS_CURSOR_MISSING" });
      }
      return id;
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
