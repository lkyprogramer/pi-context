import { ContextMaterializer } from "../../packages/kernel/src/materialization/materializer.js";
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
  emitContext(messages: PiAgentMessage[]): Promise<PiAgentMessage[]>;
}

export async function createPiHarnessWithRuntime(
  options: { materializeError?: string; throwUnhandled?: boolean } = {},
): Promise<HarnessHost> {
  let abortCalls = 0;
  let handler: ((event: { messages: PiAgentMessage[] }, ctx: ContextHookCtx) => Promise<{ messages: PiAgentMessage[] }>) | undefined;
  const pi: ExtensionAPI = {
    on(_hook, next) {
      handler = next;
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
  return {
    get abortCalls() {
      return abortCalls;
    },
    set abortCalls(value) {
      abortCalls = value;
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
