import { canonicalJson, domainHash, type HostMessage } from "@pcr/contracts";

export type DedupErrorCode =
  | "PCR_ACTIVE_TOOL_BATCH_ORPHAN";

export class DedupError extends TypeError {
  readonly code: DedupErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DedupErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "DedupError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function contentHash(message: HostMessage): string {
  return domainHash("materialization-content", {
    role: message.role,
    content: canonicalJson(message.content),
  });
}

function takeUnique(
  messages: readonly HostMessage[],
  seenIds: Set<string>,
  seenContent: Set<string>,
): HostMessage[] {
  const out: HostMessage[] = [];
  for (const message of messages) {
    const id = message.hostMessageId;
    const hash = contentHash(message);
    if (seenIds.has(id) || seenContent.has(hash)) continue;
    seenIds.add(id);
    seenContent.add(hash);
    out.push(message);
  }
  return out;
}

function takeActive(
  messages: readonly HostMessage[],
  seenIds: Set<string>,
  seenContent: Set<string>,
): HostMessage[] {
  const out: HostMessage[] = [];
  for (const message of messages) {
    const id = message.hostMessageId;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    seenContent.add(contentHash(message));
    out.push(message);
  }
  return out;
}

function callIdsFromMessage(message: HostMessage): string[] {
  const ids: string[] = [];
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) {
    if (message.role === "assistant" || message.role === "custom") ids.push(message.toolCallId);
  }
  if (!Array.isArray(message.content)) return ids;
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; id?: unknown; toolCallId?: unknown };
    if (record.type === "toolCall" && typeof record.id === "string" && record.id.length > 0) {
      ids.push(record.id);
    }
  }
  return ids;
}

function resultCallId(message: HostMessage): string | undefined {
  if (message.role !== "tool-result") return undefined;
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) return message.toolCallId;
  if (!Array.isArray(message.content)) return undefined;
  for (const block of message.content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; toolCallId?: unknown };
    if (typeof record.toolCallId === "string" && record.toolCallId.length > 0) return record.toolCallId;
  }
  return undefined;
}

export function assertActiveToolBatches(active: readonly HostMessage[]): void {
  const callIds = new Set<string>();
  let pendingAssistant = false;
  for (const message of active) {
    if (message.role === "assistant") {
      pendingAssistant = true;
      for (const id of callIdsFromMessage(message)) callIds.add(id);
      continue;
    }
    if (message.role === "tool-result") {
      const id = resultCallId(message);
      if (id) {
        if (!callIds.has(id) && !pendingAssistant) {
          throw new DedupError("PCR_ACTIVE_TOOL_BATCH_ORPHAN", { toolCallId: id, hostMessageId: message.hostMessageId });
        }
      } else if (!pendingAssistant) {
        throw new DedupError("PCR_ACTIVE_TOOL_BATCH_ORPHAN", { hostMessageId: message.hostMessageId });
      }
      pendingAssistant = false;
      continue;
    }
    pendingAssistant = false;
  }
}

function pairId(message: HostMessage): string | undefined {
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) return message.toolCallId;
  const fromContent = callIdsFromMessage(message)[0] ?? resultCallId(message);
  return fromContent;
}

function restoreToolPairs(kept: HostMessage[], original: readonly HostMessage[]): HostMessage[] {
  const keptIds = new Set(kept.map((item) => item.hostMessageId));
  const presentCalls = new Set(
    kept.filter((item) => item.role === "assistant" && pairId(item)).map((item) => pairId(item)!),
  );
  const extras: HostMessage[] = [];
  for (const message of kept) {
    if (message.role !== "tool-result") continue;
    const id = pairId(message);
    if (!id || presentCalls.has(id)) continue;
    const call = original.find((item) => item.role === "assistant" && pairId(item) === id);
    if (call && !keptIds.has(call.hostMessageId)) {
      extras.push(call);
      keptIds.add(call.hostMessageId);
      presentCalls.add(id);
    }
  }
  return extras.length === 0 ? kept : [...extras, ...kept];
}

export function dedupMaterializationMessages(
  directives: readonly HostMessage[],
  history: readonly HostMessage[],
  active: readonly HostMessage[],
): { directives: HostMessage[]; history: HostMessage[]; active: HostMessage[] } {
  const seenIds = new Set<string>();
  const seenContent = new Set<string>();
  const activeOut = takeActive(active, seenIds, seenContent);
  assertActiveToolBatches(activeOut);
  const historyOut = takeUnique(history, seenIds, seenContent);
  const directiveOut = takeUnique(directives, seenIds, seenContent);
  const original = [...directives, ...history, ...active];
  return {
    directives: directiveOut,
    history: restoreToolPairs(historyOut, original),
    active: activeOut,
  };
}
