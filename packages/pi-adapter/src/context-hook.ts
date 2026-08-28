import type { HostMessage, MaterializationInput, MaterializedView } from "../../contracts/src/index.js";
import { emptyPiUsage, toHostMessages, toPiMessages, type PiAgentMessage } from "./message-conversion.js";

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

const OPAQUE_PI_ROLES = new Set(["compactionSummary", "branchSummary", "bashExecution", "toolResult"]);

export function isOpaquePiRole(role: string): boolean {
  return OPAQUE_PI_ROLES.has(role);
}

function hasThinkingOrToolCall(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((block) => {
      const type = block && typeof block === "object" && "type" in block ? String(block.type) : "";
      return type === "thinking" || type === "toolCall";
    })
  );
}

export function isOpaquePiMessage(message: PiAgentMessage): boolean {
  return isOpaquePiRole(message.role) || (message.role === "assistant" && hasThinkingOrToolCall(message.content));
}

function withAssistantUsage(message: PiAgentMessage): PiAgentMessage {
  if (message.role !== "assistant") return message;
  if (message.usage && typeof message.usage.totalTokens === "number") return message;
  return { ...message, usage: emptyPiUsage() };
}

function withAssistantMeta(original: PiAgentMessage, converted: PiAgentMessage): PiAgentMessage {
  if (original.role !== "assistant" || converted.role !== "assistant") return converted;
  return withAssistantUsage({
    ...converted,
    usage: converted.usage ?? original.usage,
    stopReason: converted.stopReason ?? original.stopReason,
    errorMessage: converted.errorMessage ?? original.errorMessage,
    timestamp: converted.timestamp ?? original.timestamp,
  });
}

export function stitchContextMessages(
  original: readonly PiAgentMessage[],
  converted: readonly PiAgentMessage[],
): PiAgentMessage[] {
  const out: PiAgentMessage[] = [];
  let convertedIndex = 0;
  for (const message of original) {
    if (isOpaquePiMessage(message)) {
      out.push(withAssistantUsage(message));
      continue;
    }
    const next = convertedIndex < converted.length ? converted[convertedIndex++] : message;
    out.push(next ? withAssistantMeta(message, next) : withAssistantUsage(message));
  }
  while (convertedIndex < converted.length) {
    const extra = converted[convertedIndex++];
    if (extra) out.push(withAssistantUsage(extra));
  }
  return out;
}

export function registerContextHook(pi: ExtensionAPI, runtime: PiRuntime): void {
  pi.on("context", async (event, ctx) => {
    try {
      const convertible = event.messages.filter((message) => !isOpaquePiMessage(message));
      if (convertible.length === 0) return { messages: [...event.messages] };
      const input = await runtime.buildMaterializationInput(convertible, ctx);
      const view = await runtime.kernel.materialize(input);
      await runtime.stageViewReceipt(view, ctx);
      return { messages: stitchContextMessages(event.messages, runtime.converter.toPi(view.messages)) };
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
