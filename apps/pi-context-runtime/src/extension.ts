import { ContextMaterializer } from "../../../packages/kernel/src/materialization/materializer.js";
import {
  defaultSafeDiagnostic,
  registerContextHook,
  type ExtensionAPI,
} from "../../../packages/pi-adapter/src/context-hook.js";
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
  return { name: "pi-context-runtime", hooks, claimed: true, release: owner.release };
}

export default createPiContextExtension;
