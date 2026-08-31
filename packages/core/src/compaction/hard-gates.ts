import { domainHash } from "@pcr/contracts";

export interface ToolPairMessage {
  role: string;
  toolCallId?: string;
  id?: string;
  hostMessageId?: string;
  content?: unknown;
}

export interface HardGateReceipt {
  toolPairOk: boolean;
  retainedTailIds: string[];
  outputHash: string;
  secondRunHash: string;
}

function pairId(message: ToolPairMessage): string | undefined {
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) return message.toolCallId;
  if (typeof message.id === "string" && message.id.length > 0) {
    if (message.role === "toolCall" || message.role === "toolResult" || message.role === "tool-result") {
      return message.id;
    }
  }
  if (Array.isArray(message.content)) {
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const record = block as { type?: unknown; id?: unknown };
      if (record.type === "toolCall" && typeof record.id === "string" && record.id.length > 0) return record.id;
    }
  }
  return undefined;
}

function isCall(message: ToolPairMessage): boolean {
  if (message.role === "toolCall") return true;
  if (message.role === "assistant" && pairId(message)) return true;
  if (Array.isArray(message.content)) {
    return message.content.some((block) => block && typeof block === "object" && (block as { type?: unknown }).type === "toolCall");
  }
  return false;
}

function isResult(message: ToolPairMessage): boolean {
  return message.role === "toolResult" || message.role === "tool-result";
}

function messageId(message: ToolPairMessage): string | undefined {
  if (typeof message.hostMessageId === "string" && message.hostMessageId.length > 0) return message.hostMessageId;
  if (typeof message.id === "string" && message.id.length > 0) return message.id;
  return undefined;
}

export function toolPairsValid(messages: readonly ToolPairMessage[]): boolean {
  const calls = new Set<string>();
  const results = new Set<string>();
  let pendingCall: string | null = null;
  for (const message of messages) {
    const id = pairId(message);
    if (isCall(message) && id) {
      calls.add(id);
      pendingCall = id;
    }
    if (isResult(message)) {
      if (!id || !calls.has(id) || pendingCall !== id) return false;
      results.add(id);
      pendingCall = null;
    }
    if (message.role === "user" && pendingCall !== null) return false;
  }
  for (const id of calls) {
    if (!results.has(id)) return false;
  }
  for (const id of results) {
    if (!calls.has(id)) return false;
  }
  return true;
}

export function atomicCutIndex(messages: readonly ToolPairMessage[], firstKeptId: string): number {
  const index = messages.findIndex((item) => messageId(item) === firstKeptId);
  if (index <= 0) return Math.max(0, index);
  const kept = messages[index];
  if (!kept || !isResult(kept)) return index;
  const id = pairId(kept);
  if (!id) return index;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const candidate = messages[cursor];
    if (candidate && isCall(candidate) && pairId(candidate) === id) return cursor;
  }
  return index;
}

export function retainedTailIds(messages: readonly ToolPairMessage[], firstKeptId: string): string[] {
  const start = atomicCutIndex(messages, firstKeptId);
  return messages.slice(start).map((item) => messageId(item)).filter((id): id is string => typeof id === "string");
}

function omitUndefined(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(omitUndefined);
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item === undefined) continue;
    out[key] = omitUndefined(item);
  }
  return out;
}

export function twoRunHash(payload: unknown): string {
  return domainHash("checkpoint-two-run", omitUndefined(payload));
}

export function verifyHardGates(input: {
  messages: readonly ToolPairMessage[];
  firstKeptId?: string;
  payload: unknown;
  render?: () => unknown;
}): HardGateReceipt {
  const first = twoRunHash(input.render ? input.render() : input.payload);
  const second = twoRunHash(input.render ? input.render() : input.payload);
  const firstKeptId = input.firstKeptId ?? messageId(input.messages[0] ?? { role: "user" }) ?? "";
  return {
    toolPairOk: toolPairsValid(input.messages),
    retainedTailIds: firstKeptId.length === 0 ? [] : retainedTailIds(input.messages, firstKeptId),
    outputHash: first,
    secondRunHash: second,
  };
}
