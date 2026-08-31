import { ackHostCompaction, emptyPiCompactionUsage, failStagedCompaction, type StagedCompaction } from "../../../packages/pi-adapter/src/compaction-ack.js";
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
import { createRuntimeCursor } from "../../../packages/core/src/identity/stable-identity.js";
import { type SessionCompactionDecision } from "../../../packages/runtime/src/index.js";
import { candidateKey, CandidateWorker, type CandidateSnapshot } from "../../../packages/worker/src/candidate-worker.js";
import { registerOperationsCommands } from "./commands/operations.js";
import { fixtureEnvironment, runRuntimeDoctor } from "./doctor.js";
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
  }, {
    open: (sessionCtx) => userTurns.openSession(sessionCtx),
  });
  let staged: StagedCompaction | null = null;
  registerCompactionHooks(pi as unknown as CompactionExtensionAPI, {
    async prepareCompaction(event, ctx) {
      try {
        const derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
        await userTurns.ensure(ctx as never);
        const session = await userTurns.openSession(derived);
        const compact = session.prepareCompaction;
        if (typeof compact !== "function") return { kind: "native-fallback" };
        const decision = await compact.call(session, {
          operationId: "op_compact",
          cursor: sessionCursor(derived),
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
  registerSessionLifecycle(pi as never, {
    async openSession(ctx, reason, hasRawBlobs = true) {
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      lastRecoveredCursor = cursor;
      await userTurns.ensure(ctx as never);
      const report = await userTurns.recover({
        cursor,
        reason: toPcrSessionStartReason(reason),
        hasRawBlobs,
        signal: ctx.signal,
      });
      lastRecoveredCursor = report.cursor;
      return report.cursor;
    },
    async switchBranch(ctx, newLeafId) {
      const previous = lastRecoveredCursor;
      await userTurns.ensure(ctx as never);
      const cursor = sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      if (previous) {
        await userTurns.branchChanged({ cursor, previousCursor: previous, newLeafId, signal: ctx.signal });
      }
      lastRecoveredCursor = cursor;
    },
    async closeSession(ctx) {
      const cursor = lastRecoveredCursor ?? sessionCursor(derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity));
      await userTurns.closeSession(cursor);
    },
    async invalidateRouteCandidates() {},
  });
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
