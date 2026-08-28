import type { HostMessage, MaterializationInput, MaterializedView } from "../../contracts/src/index.js";
import { toHostMessages, toPiMessages, type PiAgentMessage } from "./message-conversion.js";

export interface ExtensionAPI {
  on(
    hook: "context" | string,
    handler: (event: { messages: PiAgentMessage[] }, ctx: ContextHookCtx) => Promise<{ messages: PiAgentMessage[] }>,
  ): void;
}

export interface ContextHookCtx {
  abort(): void;
  model?: { id?: string };
  thinkingLevel?: string;
  signal?: AbortSignal;
}

export interface PiRuntime {
  kernel: { materialize(input: MaterializationInput): Promise<MaterializedView> };
  buildMaterializationInput(messages: PiAgentMessage[], ctx: ContextHookCtx): Promise<MaterializationInput>;
  stageViewReceipt(view: MaterializedView, ctx: ContextHookCtx): Promise<void>;
  converter: { toPi(messages: readonly HostMessage[]): PiAgentMessage[] };
  safeDiagnostic(messages: PiAgentMessage[], error: NormalizedPcrError): PiAgentMessage[];
  deterministicFallback(messages: PiAgentMessage[], error: NormalizedPcrError): PiAgentMessage[];
}

export interface NormalizedPcrError {
  code: string;
  severity: "hard" | "soft";
}

const HARD_CODES = new Set([
  "PCR_DIRECTIVE_BUDGET_EXCEEDED",
  "PCR_UNREPAIRABLE_ACTIVE_TURN",
  "PCR_TOOL_PAIR_INVALID",
]);

export function normalizePcrError(error: unknown): NormalizedPcrError {
  const code =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : error instanceof Error
        ? error.message
        : "PCR_UNKNOWN";
  return { code, severity: HARD_CODES.has(code) ? "hard" : "soft" };
}

export function registerContextHook(pi: ExtensionAPI, runtime: PiRuntime): void {
  pi.on("context", async (event, ctx) => {
    try {
      const input = await runtime.buildMaterializationInput(event.messages, ctx);
      const view = await runtime.kernel.materialize(input);
      await runtime.stageViewReceipt(view, ctx);
      return { messages: runtime.converter.toPi(view.messages) };
    } catch (error) {
      const pcr = normalizePcrError(error);
      if (pcr.severity === "hard") {
        ctx.abort();
        return { messages: runtime.safeDiagnostic(event.messages, pcr) };
      }
      return { messages: runtime.deterministicFallback(event.messages, pcr) };
    }
  });
}

export function defaultSafeDiagnostic(messages: PiAgentMessage[], error: NormalizedPcrError): PiAgentMessage[] {
  const users = messages.filter((item) => item.role === "user");
  const lastUser = users.at(-1) ?? { role: "user", content: "continue" };
  return [
    { role: "custom", content: `PCR_SAFE_DIAGNOSTIC:${error.code}` },
    lastUser,
  ];
}

export { toHostMessages, toPiMessages };
