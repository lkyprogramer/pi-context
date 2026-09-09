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
  type Open = {
    assistantEntryId: string;
    calls: { id: string; name: string }[];
    unique: boolean;
    results: ToolBatch["results"][number][];
    hasNonText: boolean;
  };
  let open: Open | null = null;

  const callIdSet = (batch: Open) => new Set(batch.calls.map((c) => c.id));
  const satisfied = (batch: Open) =>
    batch.unique && batch.calls.every((call) => batch.results.filter((r) => r.callId === call.id).length === 1);

  function flush(complete: boolean): void {
    if (!open) return;
    batches.push({
      assistantEntryId: open.assistantEntryId,
      calls: open.calls,
      results: open.results,
      complete: complete && satisfied(open),
      hasNonText: open.hasNonText,
    });
    open = null;
  }

  function flushOpen(): void {
    if (!open) return;
    flush(satisfied(open));
  }

  for (const entry of entries) {
    const calls = callsOf(entry);
    if (calls.length) {
      if (open) flushOpen();
      const ids = calls.map((c) => c.id);
      open = {
        assistantEntryId: entry.id,
        calls,
        unique: new Set(ids).size === ids.length,
        results: [],
        hasNonText: false,
      };
      continue;
    }

    if (entry.message?.role === "toolResult") {
      const callId = toolCallIdOf(entry.message);
      if (!open || !callId || !callIdSet(open).has(callId)) {
        if (open) flushOpen();
        continue;
      }
      if (open.results.some((r) => r.callId === callId)) {
        flush(false);
        continue;
      }
      const content = contentOf(entry);
      if (content.some((block) => block.type !== "text")) open.hasNonText = true;
      open.results.push(resultMeta(entry, callId));
      continue;
    }

    if (entry.message?.role === "user" || entry.message?.role === "assistant") {
      if (open) flushOpen();
    }
  }
  if (open) flushOpen();
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
