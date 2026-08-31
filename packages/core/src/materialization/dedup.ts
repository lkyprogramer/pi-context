import { canonicalJson, domainHash, type HostMessage } from "@pcr/contracts";

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

function pairId(message: HostMessage): string | undefined {
  if (typeof message.toolCallId === "string" && message.toolCallId.length > 0) return message.toolCallId;
  return undefined;
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
  const activeOut = takeUnique(active, seenIds, seenContent);
  const historyOut = takeUnique(history, seenIds, seenContent);
  const directiveOut = takeUnique(directives, seenIds, seenContent);
  const original = [...directives, ...history, ...active];
  return {
    directives: directiveOut,
    history: restoreToolPairs(historyOut, original),
    active: restoreToolPairs(activeOut, original),
  };
}
