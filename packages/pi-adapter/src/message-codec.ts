import {
  canonicalJson,
  domainHash,
  type HostContentBlock,
  type HostMessage,
  type RuntimeCursor,
  type SourceClass,
} from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HOST_ROLES = new Set<HostMessage["role"]>(["user", "assistant", "tool-result", "custom"]);

export interface PiMessageEnvelope {
  hostMessageId: string;
  raw: unknown;
  normalized: HostMessage;
  opaqueBlocks: unknown[];
}

export interface WrapMessageInput {
  cursor: RuntimeCursor;
  raw: unknown;
  entryId?: string;
  signal?: AbortSignal;
}

export interface MessageCodec {
  wrap(input: WrapMessageInput): PiMessageEnvelope;
  unwrap(envelope: PiMessageEnvelope, signal?: AbortSignal): unknown;
}

export interface CreateMessageCodecInput {
  cursor: RuntimeCursor;
}

export type MessageCodecErrorCode =
  | "PCR_MESSAGE_CODEC_DEPENDENCY_MISSING"
  | "PCR_MESSAGE_CODEC_INPUT_INVALID"
  | "PCR_MESSAGE_CODEC_SCOPE_MISMATCH";

export class MessageCodecError extends TypeError {
  readonly code: MessageCodecErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: MessageCodecErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "MessageCodecError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new MessageCodecError("PCR_MESSAGE_CODEC_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new MessageCodecError("PCR_MESSAGE_CODEC_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function cloneRaw(value: unknown, field: string): unknown {
  try {
    return structuredClone(value);
  } catch {
    failInput(field);
  }
}

function normalizeRole(role: string): HostMessage["role"] {
  if (role === "user" || role === "assistant" || role === "tool-result" || role === "custom") return role;
  if (role === "toolResult") return "tool-result";
  return "custom";
}

function sourceClassFor(role: HostMessage["role"]): SourceClass {
  if (role === "user") return "authenticated-user";
  if (role === "tool-result") return "untrusted-tool";
  return "agent-derived";
}

function isHostBlock(value: unknown): value is HostContentBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as { type?: unknown; text?: unknown; ref?: unknown };
  if (block.type === "text") return typeof block.text === "string";
  if (block.type === "pointer" || block.type === "image-ref" || block.type === "tool-call-ref") {
    return typeof block.ref === "string" && block.ref.length > 0;
  }
  return false;
}

function splitContent(content: unknown): { blocks: HostContentBlock[]; opaque: unknown[] } {
  if (typeof content === "string") {
    return { blocks: [{ type: "text", text: content }], opaque: [] };
  }
  if (!Array.isArray(content)) {
    if (content === undefined) return { blocks: [], opaque: [] };
    return { blocks: [], opaque: [content] };
  }
  const blocks: HostContentBlock[] = [];
  const opaque: unknown[] = [];
  for (const item of content) {
    if (isHostBlock(item)) blocks.push(item);
    else opaque.push(item);
  }
  return { blocks, opaque };
}

export function createMessageCodec(input: CreateMessageCodecInput): MessageCodec {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  const bound = snapshotCursor(input.cursor, "input.cursor");

  return {
    wrap(event: WrapMessageInput): PiMessageEnvelope {
      if (!event || typeof event !== "object") failInput("event");
      if (event.signal !== undefined && !(event.signal instanceof AbortSignal)) failInput("event.signal");
      event.signal?.throwIfAborted();
      const cursor = snapshotCursor(event.cursor, "event.cursor");
      if (!sameCursor(bound, cursor)) throw new MessageCodecError("PCR_MESSAGE_CODEC_SCOPE_MISMATCH");
      if (!event.raw || typeof event.raw !== "object") failInput("event.raw");
      if (event.entryId !== undefined) requireNonEmpty(event.entryId, "event.entryId");
      const rawRecord = event.raw as Record<string, unknown>;
      if (typeof rawRecord.role !== "string" || rawRecord.role.length === 0) failInput("event.raw.role");
      event.signal?.throwIfAborted();
      const raw = cloneRaw(event.raw, "event.raw");
      const cloned = raw as Record<string, unknown>;
      const role = normalizeRole(cloned.role as string);
      if (!HOST_ROLES.has(role)) failInput("event.raw.role");
      const timestamp = typeof cloned.timestamp === "number" && Number.isFinite(cloned.timestamp)
        ? cloned.timestamp
        : 0;
      const { blocks, opaque } = splitContent(cloned.content);
      const toolCallId = typeof cloned.toolCallId === "string" && cloned.toolCallId.length > 0
        ? cloned.toolCallId
        : undefined;
      const hostMessageId = `hm_${domainHash("pi-message", {
        cursor,
        entryId: event.entryId ?? null,
        role,
        timestamp,
        toolCallId: toolCallId ?? null,
        content: canonicalJson(cloned.content ?? null),
      }).slice(0, 24)}`;
      const normalized: HostMessage = {
        hostMessageId,
        role,
        timestamp,
        content: blocks,
        sourceClass: sourceClassFor(role),
        ...(toolCallId ? { toolCallId } : {}),
      };
      return {
        hostMessageId,
        raw,
        normalized,
        opaqueBlocks: [...opaque],
      };
    },
    unwrap(envelope: PiMessageEnvelope, signal?: AbortSignal): unknown {
      if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
      signal?.throwIfAborted();
      if (!envelope || typeof envelope !== "object") failInput("envelope");
      requireNonEmpty(envelope.hostMessageId, "envelope.hostMessageId");
      if (!("raw" in envelope)) failInput("envelope.raw");
      if (!envelope.normalized || typeof envelope.normalized !== "object") failInput("envelope.normalized");
      if (!Array.isArray(envelope.opaqueBlocks)) failInput("envelope.opaqueBlocks");
      if (!envelope.hostMessageId.startsWith("hm_")) failInput("envelope.hostMessageId");
      return cloneRaw(envelope.raw, "envelope.raw");
    },
  };
}
