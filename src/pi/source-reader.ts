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

export function contentFingerprint(content: unknown): string {
  if (typeof content === "string") return hashCanonical([{ type: "text", text: content }]);
  if (!Array.isArray(content)) return hashCanonical(content ?? null);
  return hashCanonical(
    content.map((block) => ({
      type: block.type,
      text: typeof block.text === "string" ? block.text : null,
      mimeType: typeof block.mimeType === "string" ? block.mimeType : null,
      data: typeof block.data === "string" ? block.data : null,
    })),
  );
}

function toolCallIdOf(message: { toolCallId?: unknown; content?: unknown }): string | undefined {
  if (typeof message.toolCallId === "string") return message.toolCallId;
  const content = message.content;
  if (!Array.isArray(content)) return undefined;
  for (const block of content as ContentBlock[]) {
    if (typeof block.toolCallId === "string") return block.toolCallId;
  }
  return undefined;
}

export function mapOutbound(messages: Array<{ role?: string; content?: unknown; toolCallId?: unknown }>, entries: NativeEntry[]): Map<number, NativeEntry> {
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
    const callId = toolCallIdOf(msg);
    if (!callId) return;
    const candidates = byTool.get(callId) ?? [];
    const fingerprint = contentFingerprint(msg.content);
    const matched = candidates.filter((entry) => contentFingerprint(entry.message?.content) === fingerprint);
    if (matched.length === 1) map.set(i, matched[0]!);
  });
  return map;
}

export function sameTextDifferentEntries(a: NativeEntry, b: NativeEntry): boolean {
  return JSON.stringify(a.message?.content) === JSON.stringify(b.message?.content) && a.id !== b.id;
}
