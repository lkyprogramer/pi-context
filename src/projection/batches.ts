import type { EntryId, NativeEntry } from "../contracts.js";

export interface ToolBatch {
  id: string;
  assistantEntryId: EntryId;
  toolCallIds: readonly string[];
  resultEntryIds: readonly EntryId[];
  complete: boolean;
  hasUnexposedResult: boolean;
  hasImageOrUnknown: boolean;
  unresolvedFailure: boolean;
}

function contentOf(entry: NativeEntry) {
  return Array.isArray(entry.message?.content) ? entry.message!.content! : [];
}

export function collectBatches(entries: NativeEntry[], isExposed?: (id: EntryId) => boolean): ToolBatch[] {
  const resultsByCall = new Map<string, NativeEntry[]>();
  for (const entry of entries) {
    if (entry.toolCallId) {
      const list = resultsByCall.get(entry.toolCallId) ?? [];
      list.push(entry);
      resultsByCall.set(entry.toolCallId, list);
    }
  }
  const batches: ToolBatch[] = [];
  for (const entry of entries) {
    const content = contentOf(entry);
    const calls = content.filter((b) => b.type === "toolCall" || b.type === "toolUse" || typeof b.toolCallId === "string" && b.type === "function");
    const callIds = content.flatMap((b) => {
      if (typeof b.id === "string" && (b.type === "toolCall" || b.type === "toolUse")) return [b.id];
      if (typeof b.toolCallId === "string" && b.type !== "toolResult") return [String(b.toolCallId)];
      return [];
    });
    if (!callIds.length && calls.length) {
      for (const c of calls) if (typeof c.id === "string") callIds.push(c.id);
    }
    if (!callIds.length) continue;
    const resultEntries = callIds.flatMap((id) => resultsByCall.get(id) ?? []);
    const resultEntryIds = resultEntries.map((e) => e.id);
    const complete = callIds.every((id) => (resultsByCall.get(id) ?? []).length > 0);
    const hasImageOrUnknown = resultEntries.some((e) =>
      contentOf(e).some((b) => b.type !== "text"),
    );
    const unresolvedFailure = resultEntries.some((e) => e.message?.stopReason === "error");
    batches.push({
      id: `batch:${entry.id}`,
      assistantEntryId: entry.id,
      toolCallIds: callIds,
      resultEntryIds,
      complete,
      hasUnexposedResult: resultEntryIds.some((id) => (isExposed ? !isExposed(id) : true)),
      hasImageOrUnknown,
      unresolvedFailure,
    });
  }
  return batches;
}

export function protectSet(batches: ToolBatch[], recent: number): Set<EntryId> {
  const complete = batches.filter((b) => b.complete);
  const keep = complete.slice(-recent);
  const ids = new Set<EntryId>();
  for (const b of [...keep, ...batches.filter((b) => !b.complete || b.hasImageOrUnknown || b.unresolvedFailure)]) {
    ids.add(b.assistantEntryId);
    for (const id of b.resultEntryIds) ids.add(id);
  }
  return ids;
}
