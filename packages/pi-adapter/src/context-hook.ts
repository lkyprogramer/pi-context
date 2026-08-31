import { domainHash, type HostMessage, type MaterializedView, type RuntimeCursor } from "@pcr/contracts";
import { createMessageCodec, type PiMessageEnvelope } from "./message-codec.js";
import { toHostMessages, toPiMessages, type PiAgentMessage } from "./message-conversion.js";

export interface PiSessionContext {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
  signal?: AbortSignal;
  currentContextWindow?: number;
  maxOutputTokens?: number;
}

export interface ContextHookSession {
  materialize(request: {
    operationId: string;
    cursor: RuntimeCursor;
    canonicalMessages: readonly HostMessage[];
    currentContextWindow: number;
    maxOutputTokens: number;
    reason: "normal" | "overflow-retry" | "manual-preview";
    now: number;
    signal?: AbortSignal;
  }): Promise<MaterializedView>;
}

export interface RuntimeSessionRegistry {
  open(ctx: PiSessionContext): Promise<ContextHookSession>;
}

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
  workspaceId?: string;
  sessionId?: string;
  leafId?: string | null;
  lineageHash?: string;
  modelKey?: string;
  now?: number;
  currentContextWindow?: number;
  maxOutputTokens?: number;
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

export type ContextHookErrorCode =
  | "PCR_CONTEXT_HOOK_DEPENDENCY_MISSING"
  | "PCR_CONTEXT_HOOK_INPUT_INVALID"
  | "PCR_CONTEXT_HOOK_SCOPE_MISMATCH";

export class ContextHookError extends TypeError {
  readonly code: ContextHookErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ContextHookErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ContextHookError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new ContextHookError("PCR_CONTEXT_HOOK_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new ContextHookError("PCR_CONTEXT_HOOK_INPUT_INVALID", { field });
}

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
    Array.isArray(content)
    && content.some((block) => {
      const type = block && typeof block === "object" && "type" in block ? String(block.type) : "";
      return type === "thinking" || type === "toolCall";
    })
  );
}

export function isOpaquePiMessage(message: PiAgentMessage): boolean {
  return isOpaquePiRole(message.role) || (message.role === "assistant" && hasThinkingOrToolCall(message.content));
}

function withAssistantUsage(message: PiAgentMessage): PiAgentMessage {
  return message;
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

export function defaultSafeDiagnostic(messages: PiAgentMessage[], error: NormalizedPcrError): PiAgentMessage[] {
  const users = messages.filter((item) => item.role === "user");
  const lastUser = users.at(-1) ?? { role: "user", content: "continue" };
  return [
    { role: "custom", content: `PCR_SAFE_DIAGNOSTIC:${error.code}` },
    lastUser,
  ];
}

function sessionContextFrom(ctx: ContextHookCtx): PiSessionContext {
  if (!ctx || typeof ctx !== "object") failInput("ctx");
  if (typeof ctx.workspaceId !== "string" || ctx.workspaceId.length === 0) failInput("ctx.workspaceId");
  if (typeof ctx.sessionId !== "string" || ctx.sessionId.length === 0) failInput("ctx.sessionId");
  if (ctx.leafId !== undefined && ctx.leafId !== null && (typeof ctx.leafId !== "string" || ctx.leafId.length === 0)) {
    failInput("ctx.leafId");
  }
  if (typeof ctx.lineageHash !== "string" || ctx.lineageHash.length === 0) failInput("ctx.lineageHash");
  const modelKey = ctx.modelKey ?? ctx.model?.id;
  if (typeof modelKey !== "string" || modelKey.length === 0) failInput("ctx.modelKey");
  return {
    workspaceId: ctx.workspaceId,
    sessionId: ctx.sessionId,
    leafId: ctx.leafId === undefined ? null : ctx.leafId,
    lineageHash: ctx.lineageHash,
    modelKey,
    signal: ctx.signal,
    ...(typeof ctx.currentContextWindow === "number" ? { currentContextWindow: ctx.currentContextWindow } : {}),
    ...(typeof ctx.maxOutputTokens === "number" ? { maxOutputTokens: ctx.maxOutputTokens } : {}),
  };
}

function stableContextEntryId(raw: PiAgentMessage): string {
  const record = raw && typeof raw === "object" ? raw as PiAgentMessage & { id?: string } : undefined;
  if (record && typeof record.id === "string" && record.id.length > 0) return record.id;
  const content = typeof record?.content === "string"
    ? record.content
    : Array.isArray(record?.content)
      ? record.content.map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && "text" in block) return String(block.text ?? "");
        return "";
      }).join("\n")
      : "";
  return `ctx_${domainHash("ctx-entry", {
    role: record?.role ?? null,
    toolCallId: record?.toolCallId ?? null,
    content,
  }).slice(0, 16)}`;
}

function cursorFrom(context: PiSessionContext): RuntimeCursor {
  return {
    workspaceId: context.workspaceId,
    sessionId: context.sessionId,
    leafId: context.leafId,
    lineageHash: context.lineageHash,
    modelKey: context.modelKey,
  };
}

function hostToPi(message: HostMessage, envelopes: ReadonlyMap<string, PiMessageEnvelope>): PiAgentMessage {
  const envelope = envelopes.get(message.hostMessageId);
  if (envelope && envelope.raw && typeof envelope.raw === "object") {
    return envelope.raw as PiAgentMessage;
  }
  const role = message.role === "tool-result" ? "toolResult" : message.role;
  const texts = message.content.filter((block) => block.type === "text").map((block) => block.text);
  const content = role === "assistant"
    ? (texts.length > 0 ? texts : [""]).map((text) => ({ type: "text", text }))
    : texts.length === 1
      ? texts[0]
      : texts.join("");
  return {
    role,
    content,
    timestamp: message.timestamp,
    ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
  };
}

function viewToPi(view: MaterializedView, envelopes: ReadonlyMap<string, PiMessageEnvelope>): PiAgentMessage[] {
  return view.messages.map((message) => hostToPi(message, envelopes));
}

export function registerContextHook(pi: ExtensionAPI, registry: RuntimeSessionRegistry): void {
  if (!pi || typeof pi.on !== "function") failMissing("pi");
  if (!registry || typeof registry.open !== "function") failMissing("registry");
  pi.on("context", async (event, ctx) => {
    try {
      if (!event || !Array.isArray(event.messages)) failInput("event.messages");
      if (!ctx || typeof ctx.abort !== "function") failInput("ctx");
      ctx.signal?.throwIfAborted();
      const sessionContext = sessionContextFrom(ctx);
      const cursor = cursorFrom(sessionContext);
      const session = await registry.open(sessionContext);
      ctx.signal?.throwIfAborted();
      const codec = createMessageCodec({ cursor });
      const envelopes = new Map<string, PiMessageEnvelope>();
      const canonical: HostMessage[] = [];
      for (const raw of event.messages) {
        const stableId = stableContextEntryId(raw);
        const envelope = codec.wrap({ cursor, raw, entryId: stableId });
        envelopes.set(envelope.hostMessageId, envelope);
        canonical.push(envelope.normalized);
      }
      const view = await session.materialize({
        operationId: "op_context",
        cursor,
        canonicalMessages: canonical,
        currentContextWindow: typeof ctx.currentContextWindow === "number" ? ctx.currentContextWindow : 200192,
        maxOutputTokens: typeof ctx.maxOutputTokens === "number" ? ctx.maxOutputTokens : 16384,
        reason: "normal",
        now: typeof ctx.now === "number" && Number.isFinite(ctx.now) ? ctx.now : 0,
        signal: ctx.signal,
      });
      return { messages: viewToPi(view, envelopes) };
    } catch (error) {
      if (error instanceof ContextHookError) throw error;
      if (typeof error === "object" && error && "name" in error && error.name === "AbortError") throw error;
      const pcr = normalizePcrError(error);
      if (pcr.severity === "hard") {
        ctx?.abort();
        return { messages: defaultSafeDiagnostic(event?.messages ?? [], pcr) };
      }
      throw error;
    }
  });
}

export { toHostMessages, toPiMessages };
