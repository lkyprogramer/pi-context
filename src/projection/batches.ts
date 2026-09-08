import type { ContentBlock, EntryId, NativeEntry, ToolBatch } from "../contracts.js";
import { utf8Bytes } from "../contracts.js";
import { toolCallIdOf } from "../pi/source-reader.js";

export type { ToolBatch };

function contentOf(entry: NativeEntry): ContentBlock[] {
  const raw = entry.message?.content;
  return Array.isArray(raw) ? raw : typeof raw === "string" ? [{ type: "text", text: raw }] : [];
}

function callsOf(entry: NativeEntry): { id: string; name: string }[] {
  if (entry.message?.role !== "assistant") return [];
  return contentOf(entry).flatMap((block) => {
    if (block.type !== "toolCall" || typeof block.id !== "string") return [];
    return [{ id: block.id, name: typeof block.name === "string" ? block.name : "" }];
  });
}

function resultMeta(entry: NativeEntry, callId: string): ToolBatch["results"][number] {
  const content = contentOf(entry);
  const textBlocks: number[] = [];
  let bytes = 0;
  content.forEach((block, index) => {
    if (block.type !== "text") return;
    textBlocks.push(index);
    bytes += utf8Bytes(typeof block.text === "string" ? block.text : "").length;
  });
  return {
    entryId: entry.id,
    callId,
    isError: entry.message?.isError === true,
    textBlocks,
    bytes,
  };
}

export function collectBatches(entries: readonly NativeEntry[]): ToolBatch[] {
  const batches: ToolBatch[] = [];
  for (const entry of entries) {
    const calls = callsOf(entry);
    if (!calls.length) continue;
    const callIds = new Set(calls.map((c) => c.id));
    const results: ToolBatch["results"][number][] = [];
    let hasNonText = false;
    for (const other of entries) {
      if (other.message?.role !== "toolResult") continue;
      const callId = toolCallIdOf(other.message);
      if (!callId || !callIds.has(callId)) continue;
      const content = contentOf(other);
      if (content.some((block) => block.type !== "text")) hasNonText = true;
      results.push(resultMeta(other, callId));
    }
    const complete = calls.every((call) => results.filter((r) => r.callId === call.id).length === 1);
    batches.push({
      assistantEntryId: entry.id,
      calls,
      results,
      complete,
      hasNonText,
    });
  }
  return batches;
}

export function protectSet(batches: readonly ToolBatch[], recent: number): Set<EntryId> {
  const complete = batches.filter((b) => b.complete);
  const keepLast = new Set(complete.slice(Math.max(0, complete.length - recent)));
  const ids = new Set<EntryId>();
  for (const batch of batches) {
    const keep =
      keepLast.has(batch) ||
      !batch.complete ||
      batch.hasNonText ||
      batch.results.some((r) => r.isError);
    if (!keep) continue;
    for (const result of batch.results) ids.add(result.entryId);
  }
  return ids;
}
