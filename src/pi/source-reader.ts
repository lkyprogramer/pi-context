import type { ContentBlock, NativeEntry } from "../contracts.js";
import { hashCanonical } from "../contracts.js";

export interface SessionReader {
  getSessionId(): string;
  getLeafId(): string | null;
  getEntry(id: string): NativeEntry | undefined;
  getEntries?(): NativeEntry[];
}

export function readVisibleSnapshot(reader: SessionReader): NativeEntry[] {
  const out: NativeEntry[] = [];
  const seen = new Set<string>();
  let cursor = reader.getLeafId();
  while (cursor) {
    if (seen.has(cursor)) break;
    seen.add(cursor);
    const entry = reader.getEntry(cursor);
    if (!entry) break;
    out.push(entry);
    cursor = entry.parentId;
  }
  return out.reverse();
}

export function mapOutbound(messages: Array<{ role?: string; content?: unknown }>, entries: NativeEntry[]): Map<number, NativeEntry> {
  const map = new Map<number, NativeEntry>();
  const byTool = new Map<string, NativeEntry[]>();
  for (const entry of entries) {
    if (entry.toolCallId) {
      const list = byTool.get(entry.toolCallId) ?? [];
      list.push(entry);
      byTool.set(entry.toolCallId, list);
    }
  }
  messages.forEach((msg, i) => {
    const content = msg.content;
    if (!Array.isArray(content)) return;
    for (const block of content as ContentBlock[]) {
      const callId = typeof block.toolCallId === "string" ? block.toolCallId : undefined;
      if (!callId) continue;
      const candidates = byTool.get(callId) ?? [];
      const hash = hashCanonical(block);
      const matched = candidates.filter((e) => hashCanonical(e.message?.content ?? e) === hash);
      if (matched.length === 1) map.set(i, matched[0]!);
    }
  });
  return map;
}

export function sameTextDifferentEntries(a: NativeEntry, b: NativeEntry): boolean {
  return JSON.stringify(a.message?.content) === JSON.stringify(b.message?.content) && a.id !== b.id;
}
