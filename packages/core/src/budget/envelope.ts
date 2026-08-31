import { estimateTextTokens } from "./pricer.js";

export interface EnvelopeBlock {
  type?: string;
  text?: string;
  thinking?: string;
  arguments?: unknown;
  summary?: string;
  name?: string;
  id?: string;
}

export interface EnvelopeMessage {
  role: string;
  content?: string | EnvelopeBlock | EnvelopeBlock[];
  summary?: string;
  details?: unknown;
  metadata?: unknown;
  image?: unknown;
  custom?: unknown;
  toolCallId?: string;
  thinking?: string;
}

const MAX_DEPTH = 8;

function pushJson(parts: string[], value: unknown): void {
  try {
    parts.push(JSON.stringify(value));
  } catch {
    parts.push(String(value));
  }
}

function collectBlock(parts: string[], block: EnvelopeBlock): void {
  if (typeof block.text === "string") parts.push(block.text);
  if (typeof block.thinking === "string") parts.push(block.thinking);
  if (typeof block.summary === "string") parts.push(block.summary);
  if (typeof block.name === "string") parts.push(block.name);
  if (block.arguments !== undefined) pushJson(parts, block.arguments);
}

function collectValue(parts: string[], value: unknown, depth: number): void {
  if (value == null || depth > MAX_DEPTH) return;
  if (typeof value === "string") {
    if (value.length > 0) parts.push(value);
    return;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    parts.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectValue(parts, item, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (typeof record.role === "string") parts.push(record.role);
  if (typeof record.summary === "string") parts.push(record.summary);
  if (typeof record.thinking === "string") parts.push(record.thinking);
  if (typeof record.text === "string") parts.push(record.text);
  if (typeof record.toolCallId === "string") parts.push(record.toolCallId);
  if (record.arguments !== undefined) pushJson(parts, record.arguments);
  if (record.details !== undefined) pushJson(parts, record.details);
  if (record.metadata !== undefined) pushJson(parts, record.metadata);
  if (record.image !== undefined) pushJson(parts, record.image);
  if (record.custom !== undefined) pushJson(parts, record.custom);
  if (record.content !== undefined) collectValue(parts, record.content, depth + 1);
  if (Array.isArray(record.toolCalls)) collectValue(parts, record.toolCalls, depth + 1);
}

export function envelopeFromRaw(raw: unknown): EnvelopeMessage {
  if (!raw || typeof raw !== "object") return { role: "unknown" };
  const record = raw as Record<string, unknown>;
  const role = typeof record.role === "string" && record.role.length > 0 ? record.role : "unknown";
  const message: EnvelopeMessage = { role };
  if (typeof record.summary === "string") message.summary = record.summary;
  if (typeof record.thinking === "string") message.thinking = record.thinking;
  if (typeof record.toolCallId === "string") message.toolCallId = record.toolCallId;
  if (record.details !== undefined) message.details = record.details;
  if (record.metadata !== undefined) message.metadata = record.metadata;
  if (record.image !== undefined) message.image = record.image;
  if (record.custom !== undefined) message.custom = record.custom;
  if (typeof record.content === "string") message.content = record.content;
  else if (Array.isArray(record.content)) message.content = record.content as EnvelopeBlock[];
  else if (record.content && typeof record.content === "object") message.content = record.content as EnvelopeBlock;
  return message;
}

export function serializedEnvelopeText(message: EnvelopeMessage): string {
  if (!message || typeof message !== "object") return "";
  const parts: string[] = [];
  if (typeof message.role === "string" && message.role.length > 0) parts.push(message.role);
  if (typeof message.summary === "string") parts.push(message.summary);
  if (typeof message.thinking === "string") parts.push(message.thinking);
  if (typeof message.toolCallId === "string") parts.push(message.toolCallId);
  if (typeof message.content === "string") parts.push(message.content);
  else if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      collectBlock(parts, block);
    }
  } else if (message.content && typeof message.content === "object") {
    collectBlock(parts, message.content);
  }
  if (message.details !== undefined) pushJson(parts, message.details);
  if (message.metadata !== undefined) pushJson(parts, message.metadata);
  if (message.image !== undefined) pushJson(parts, message.image);
  if (message.custom !== undefined) pushJson(parts, message.custom);
  return parts.join("\n");
}

export function serializedRawPayload(raw: unknown): string {
  const parts: string[] = [];
  collectValue(parts, raw, 0);
  return parts.join("\n");
}

export function priceEnvelope(messages: readonly EnvelopeMessage[]): number {
  return messages.reduce((sum, message) => sum + estimateTextTokens(serializedEnvelopeText(message)), 0);
}

export function priceRawPayload(raw: unknown): number {
  const text = serializedRawPayload(raw);
  return text.length === 0 ? 0 : estimateTextTokens(text);
}
