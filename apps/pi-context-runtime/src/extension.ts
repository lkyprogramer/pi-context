import { ackHostCompaction, failStagedCompaction, type StagedCompaction } from "../../../packages/pi-adapter/src/compaction-ack.js";
import {
  registerCompactionHooks,
  toPiCompactionResult,
  type CompactionExtensionAPI,
} from "../../../packages/pi-adapter/src/compaction-hook.js";
import {
  registerContextHook,
  type ExtensionAPI,
  type RuntimeSessionRegistry,
} from "../../../packages/pi-adapter/src/context-hook.js";
import { isHardBackgroundPath, registerBackgroundHook } from "../../../packages/pi-adapter/src/background-hook.js";
import { registerRuntimeTools } from "../../../packages/pi-adapter/src/commands/context.js";
import { registerSessionLifecycle } from "../../../packages/pi-adapter/src/lifecycle.js";
import { ContextMaterializer } from "../../../packages/kernel/src/materialization/materializer.js";
import { createRuntimeCursor } from "../../../packages/core/src/identity/stable-identity.js";
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

function createExtensionContextRegistry(): RuntimeSessionRegistry {
  const materializer = new ContextMaterializer({ directives: "keep" });
  return {
    async open(ctx) {
      return {
        async materialize(request) {
          return materializer.materialize({
            cursor: {
              workspaceId: ctx.workspaceId,
              sessionId: ctx.sessionId,
              leafId: ctx.leafId,
              lineageHash: ctx.lineageHash,
              modelKey: ctx.modelKey,
              thinkingLevel: "off",
            },
            canonicalMessages: request.canonicalMessages,
            currentContextWindow: request.currentContextWindow,
            maxOutputTokens: request.maxOutputTokens,
            reason: request.reason,
            now: request.now,
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
        try {
          const derived = derivePiSessionContext(ctx as unknown as PiRuntimeContext, identity);
          return await handler(event, {
            abort: () => {
              if (ctx && typeof ctx === "object" && "abort" in ctx && typeof ctx.abort === "function") ctx.abort();
            },
            signal: ctx && typeof ctx === "object" && "signal" in ctx ? ctx.signal : undefined,
            workspaceId: derived.workspaceId,
            sessionId: derived.sessionId,
            leafId: derived.leafId,
            lineageHash: derived.lineageHash,
            modelKey: derived.modelKey,
            now: 0,
          });
        } catch {
          return { messages: event.messages };
        }
      });
    },
  }, hookRegistry);
  let staged: StagedCompaction | null = null;
  registerCompactionHooks(pi as unknown as CompactionExtensionAPI, {
    async buildCheckpoint(preparation, reason) {
      try {
        const spec = new URL("../../../packages/kernel/src/compaction/candidate.js", import.meta.url).href;
        const loaded = (await import(spec)) as {
          buildDeterministicCheckpointCandidate: (
            preparation: unknown,
            state: unknown,
          ) => Promise<{ kind: "ready"; candidate: StagedCompaction["candidate"] } | { kind: "rejected"; code: string }>;
        };
        const directives = directivesFromPreparation(preparation);
        return await loaded.buildDeterministicCheckpointCandidate(
          {
            tokensBefore: preparation.tokensBefore,
            firstKeptEntryId: preparation.firstKeptEntryId,
            retainedTail: preparation.retainedTail ?? [],
            branchScope: preparation.branchScope ?? "main",
            head: preparation.head ?? "leaf-a",
            directives,
            reason,
          },
          {
            checkpoint: {
              directives: directives.map((item) => ({
                ...item,
                quote: item.quote.slice(0, 240),
                polarity: "must-not" as const,
                status: "active" as const,
              })),
              continuity: { revisionId: "cr_runtime" },
              maxCheckpointTokens: 1024,
              claims: [],
              pointers: [],
              heads: {
                contextHead: "ctx_runtime",
                directiveHead: "dh_runtime",
                claimHead: "ch_runtime",
                continuityHead: "cth_runtime",
              },
            },
            counter: {
              countText: (text: string) => Math.ceil(text.length / 4),
              countMessages: (messages: readonly unknown[]) => (Array.isArray(messages) ? messages.length : 0) * 10,
            },
          },
        );
      } catch {
        return { kind: "rejected", code: "PCR_CHECKPOINT_LOAD_FAILED" };
      }
    },
    async stageCompaction(candidate) {
      staged = { candidate, result: toPiCompactionResult(candidate) };
    },
    toPiCompactionResult,
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
  registerSessionLifecycle(pi as never, {
    async openSession() {},
    async switchBranch() {},
    async closeSession() {},
    async invalidateRouteCandidates() {},
  });
  let worker: CandidateWorker | undefined;
  const backgroundSnapshot = (): CandidateSnapshot => ({
    workspaceId: "ws_0123456789abcdef",
    sessionId: "s1",
    leafId: "leaf-a",
    lineageHash: "1111111111111111111111111111111111111111111111111111111111111111",
    sourceHead: "src_runtime",
    modelKey: "pcr",
    thinkingLevel: "off",
    contextWindow: 128000,
    systemPromptHash: "sys_runtime",
    activeToolSetHash: "tools_runtime",
    reducerRevisionSet: "red_runtime",
    extractorRevision: "ext_runtime",
    schemaVersion: "1",
    configFingerprint: "cfg_runtime",
  });
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
  registerRuntimeTools(pi, {
    workspaceId: "ws_0123456789abcdef",
    cursor: {
      workspaceId: `ws_${"0".repeat(40)}`,
      sessionId: "unbound",
      leafId: null,
      lineageHash: "0".repeat(64),
      modelKey: "unbound",
    },
    evidence: {
      async admit() {
        throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
      },
      async search() {
        throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
      },
      async read() {
        throw Object.assign(new Error("PCR_RETRIEVAL_DEPENDENCY_MISSING"), { code: "PCR_RETRIEVAL_DEPENDENCY_MISSING" });
      },
    },
    claimed: true,
    commands: {
      status: (ctx) =>
        JSON.stringify({ ok: true, command: "context", workspaceId: ctx.workspaceId ?? "ws_0123456789abcdef", claimed: true }),
      doctor: async (ctx) =>
        JSON.stringify({
          command: "context-doctor",
          workspaceId: ctx.workspaceId ?? "ws_0123456789abcdef",
          ...(await runRuntimeDoctor(
            fixtureEnvironment({
              nodeVersion: process.versions.node,
              piVersion: "0.84.4",
              packages: [],
              trusted: true,
            }),
            { conflictPolicy: "strict" },
          )),
        }),
      compact: (ctx) =>
        JSON.stringify({ ok: true, command: "context-compact", workspaceId: ctx.workspaceId ?? "ws_0123456789abcdef" }),
    },
  });
  registerOperationsCommands(pi, { workspaceId: "ws_0123456789abcdef" });
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
