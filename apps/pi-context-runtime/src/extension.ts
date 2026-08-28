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
import { registerSessionLifecycle } from "../../../packages/pi-adapter/src/lifecycle.js";
import { toHostMessages, toPiMessages } from "../../../packages/pi-adapter/src/message-conversion.js";
import { claimPiContextOwner } from "./owner.js";

export interface ExtensionFactoryOptions {
  claimOnCreate?: boolean;
}

export interface PiContextExtension {
  name: "pi-context-runtime";
  hooks: Record<string, unknown>;
  claimed: boolean;
  release?: () => void;
}

export function createPiContextExtension(options: ExtensionFactoryOptions = {}): PiContextExtension {
  if (!options.claimOnCreate) {
    return { name: "pi-context-runtime", hooks: {}, claimed: false };
  }
  const owner = claimPiContextOwner("pi-context-runtime");
  const hooks: Record<string, unknown> = {};
  const pi: ExtensionAPI = {
    on(hook, handler) {
      hooks[hook] = handler;
    },
  };
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
  return { name: "pi-context-runtime", hooks, claimed: true, release: owner.release };
}

export default createPiContextExtension;
