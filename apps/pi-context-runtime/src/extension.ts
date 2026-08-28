import { ContextMaterializer } from "../../../packages/kernel/src/materialization/materializer.js";
import { ackHostCompaction, failStagedCompaction, type StagedCompaction } from "../../../packages/pi-adapter/src/compaction-ack.js";
import {
  registerCompactionHooks,
  toPiCompactionResult,
  type CompactionExtensionAPI,
} from "../../../packages/pi-adapter/src/compaction-hook.js";
import {
  defaultSafeDiagnostic,
  registerContextHook,
  type ExtensionAPI,
} from "../../../packages/pi-adapter/src/context-hook.js";
import { isHardBackgroundPath, registerBackgroundHook } from "../../../packages/pi-adapter/src/background-hook.js";
import { registerRuntimeTools } from "../../../packages/pi-adapter/src/commands/context.js";
import { registerSessionLifecycle } from "../../../packages/pi-adapter/src/lifecycle.js";
import { toHostMessages, toPiMessages } from "../../../packages/pi-adapter/src/message-conversion.js";
import { candidateKey, CandidateWorker, type CandidateSnapshot } from "../../../packages/worker/src/candidate-worker.js";
import { claimPiContextOwner } from "./owner.js";

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
  release?: () => void;
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

function bindClaimedRuntime(pi: HostExtensionAPI): PiContextExtension {
  const owner = claimPiContextOwner("pi-context-runtime");
  const materializer = new ContextMaterializer({ directives: "keep" });
  registerContextHook(pi, {
    kernel: { materialize: (input) => materializer.materialize(input) },
    async buildMaterializationInput(messages, ctx) {
      return {
        cursor: {
          workspaceId: "ws_0123456789abcdef",
          sessionId: "s1",
          leafId: null,
          lineageHash: "1111111111111111111111111111111111111111111111111111111111111111",
          modelKey: ctx.model?.id ?? "pcr",
          thinkingLevel: ctx.thinkingLevel ?? "off",
        },
        canonicalMessages: toHostMessages(messages),
        currentContextWindow: 128000,
        maxOutputTokens: 16000,
        reason: "normal",
        now: Date.now(),
      };
    },
    async stageViewReceipt() {},
    converter: { toPi: toPiMessages },
    safeDiagnostic: defaultSafeDiagnostic,
    deterministicFallback: (messages) => messages,
  });
  let staged: StagedCompaction | null = null;
  registerCompactionHooks(pi as unknown as CompactionExtensionAPI, {
    async buildCheckpoint(preparation, reason) {
      const spec = new URL("../../../packages/kernel/src/compaction/candidate.js", import.meta.url).href;
      const loaded = (await import(spec)) as {
        buildDeterministicCheckpointCandidate: (
          preparation: unknown,
          state: unknown,
        ) => Promise<{ kind: "ready"; candidate: StagedCompaction["candidate"] } | { kind: "rejected"; code: string }>;
      };
      return loaded.buildDeterministicCheckpointCandidate(
        {
          tokensBefore: preparation.tokensBefore,
          firstKeptEntryId: preparation.firstKeptEntryId,
          retainedTail: preparation.retainedTail,
          branchScope: preparation.branchScope ?? "main",
          head: preparation.head ?? "leaf-a",
          directives: preparation.directives,
          reason,
        },
        {
          checkpoint: {
            directives: preparation.directives?.map((item) => ({ ...item, polarity: "must-not", status: "active" })) ?? [],
            continuity: { revisionId: "cr_runtime" },
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
            countMessages: (messages: readonly unknown[]) => messages.length * 10,
          },
        },
      );
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
  registerRuntimeTools(pi, { workspaceId: "ws_0123456789abcdef", claimed: true });
  return { name: "pi-context-runtime", hooks: {}, claimed: true, release: owner.release };
}

export default createPiContextExtension;
