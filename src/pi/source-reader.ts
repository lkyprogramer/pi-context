import type { ContentBlock, NativeEntry } from "../contracts.js";
import { hashCanonical } from "../contracts.js";

export interface SessionReader {
  getSessionId(): string;
  getLeafId(): string | null;
  getEntry(id: string): NativeEntry | undefined;
  getEntries?(): NativeEntry[];
  getSessionDir?(): string | undefined;
}

export function sessionDirOf(sm: SessionReader | undefined | null): string | null {
  if (!sm || typeof sm.getSessionDir !== "function") return null;
  const dir = sm.getSessionDir();
  return typeof dir === "string" && dir.trim() ? dir : null;
}

export function sessionSnapshot(ctx: { cwd?: string; sessionManager?: SessionReader }): {
  entries: NativeEntry[];
  sessionId: string;
  leafId: string | null;
  cwd: string;
  sessionDir: string | null;
} {
  const sm = ctx.sessionManager;
  const cwd = ctx.cwd || process.cwd();
  if (!sm) return { entries: [], sessionId: "unknown", leafId: null, cwd, sessionDir: null };
  const sessionId = sm.getSessionId();
  const leafId = sm.getLeafId();
  const entries = typeof sm.getEntries === "function" ? [...(sm.getEntries() as NativeEntry[])] : readVisibleSnapshot(sm);
  return {
    entries: includeHiddenAncestors(sm, entries, leafId),
    sessionId,
    leafId,
    cwd,
    sessionDir: sessionDirOf(sm),
  };
}

/** Official getEntries() omits the session header, which is still the parent of the first real entry. */
function includeHiddenAncestors(sm: SessionReader, listed: NativeEntry[], leafId: string | null): NativeEntry[] {
  if (typeof sm.getEntry !== "function") return listed;
  const byId = new Map(listed.map((entry) => [entry.id, entry]));
  const extra: NativeEntry[] = [];
  const seen = new Set<string>();
  let cursor = leafId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    let entry = byId.get(cursor);
    if (!entry) {
      const hidden = sm.getEntry(cursor);
      if (!hidden) break;
      entry = hidden;
      byId.set(entry.id, entry);
      extra.push(entry);
    }
    cursor = entry.parentId ?? null;
  }
  return extra.length === 0 ? listed : [...extra, ...listed];
}

export function branchEntries(sessionManager: SessionReader): NativeEntry[] {
  return readVisibleSnapshot(sessionManager);
}

export function archiveBranch(
  entries: readonly NativeEntry[],
  leafId: string | null,
): { branch: NativeEntry[]; diagnostics: string[] } {
  if (!leafId) return { branch: [], diagnostics: ["missing-leaf"] };
  const byId = new Map<string, NativeEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
  }
  const rev: NativeEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafId;
  while (cursor) {
    if (seen.has(cursor)) return { branch: [], diagnostics: ["cycle"] };
    seen.add(cursor);
    const entry = byId.get(cursor);
    if (!entry) return { branch: [], diagnostics: ["missing-parent"] };
    rev.push(entry);
    cursor = entry.parentId ?? null;
  }
  return { branch: rev.reverse(), diagnostics: [] };
}

export function latestCompactionId(entries: readonly NativeEntry[], leafId?: string | null): string | null {
  const source = leafId === undefined ? entries : archiveBranch(entries, leafId).branch;
  for (let i = source.length - 1; i >= 0; i--) {
    const entry = source[i]!;
    if (entry.type === "compaction" || entry.customType === "compaction") return entry.id;
  }
  return null;
}

export function mapToolResults(
  messages: ReadonlyArray<{ role?: string; toolCallId?: unknown; content?: unknown }>,
  entries: readonly NativeEntry[],
): Map<number, { entryId: string }> {
  const index = toolResultIndex(entries);
  const byCall = new Map<string, number[]>();
  messages.forEach((msg, i) => {
    if (msg.role !== "toolResult") return;
    const callId = toolCallIdOf(msg);
    if (!callId) return;
    const list = byCall.get(callId) ?? [];
    list.push(i);
    byCall.set(callId, list);
  });
  const mapped = new Map<number, { entryId: string }>();
  for (const [callId, indexes] of byCall) {
    if (indexes.length !== 1) continue;
    const hit = index.get(callId);
    if (!hit || hit === "ambiguous") continue;
    mapped.set(indexes[0]!, { entryId: hit });
  }
  return mapped;
}

export function toolResultIndex(entries: readonly NativeEntry[]): Map<string, string | "ambiguous"> {
  const map = new Map<string, string | "ambiguous">();
  for (const entry of entries) {
    if (entry.message?.role !== "toolResult") continue;
    const callId = toolCallIdOf(entry.message);
    if (!callId) continue;
    if (!map.has(callId)) map.set(callId, entry.id);
    else map.set(callId, "ambiguous");
  }
  return map;
}

export function toolResultByCallId(entries: readonly NativeEntry[]): Map<string, NativeEntry> {
  const map = new Map<string, NativeEntry>();
  for (const entry of entries) {
    if (entry.message?.role !== "toolResult") continue;
    const callId = toolCallIdOf(entry.message);
    if (!callId || map.has(callId)) continue;
    map.set(callId, entry);
  }
  return map;
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
  const blocks = typeof content === "string"
    ? [{ type: "text", text: content, mimeType: undefined, data: undefined }]
    : Array.isArray(content)
      ? content
      : null;
  if (!blocks) return hashCanonical(content ?? null);
  return hashCanonical(
    blocks.map((block) => ({
      type: (block as { type?: unknown }).type ?? "text",
      text: typeof (block as { text?: unknown }).text === "string" ? (block as { text: string }).text : null,
      mimeType: typeof (block as { mimeType?: unknown }).mimeType === "string" ? (block as { mimeType: string }).mimeType : null,
      data: typeof (block as { data?: unknown }).data === "string" ? (block as { data: string }).data : null,
    })),
  );
}

export function toolCallIdOf(message: { toolCallId?: unknown; content?: unknown } | undefined): string | undefined {
  if (!message) return undefined;
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
    if (entry.message?.role !== "toolResult") continue;
    const callId = toolCallIdOf(entry.message);
    if (!callId) continue;
    const list = byTool.get(callId) ?? [];
    list.push(entry);
    byTool.set(callId, list);
  }
  messages.forEach((msg, i) => {
    if (msg.role !== "toolResult") return;
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
