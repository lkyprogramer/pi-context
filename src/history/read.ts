import type { ContentBlock, HistoryResult, NativeEntry, Scope } from "../contracts.js";
import { estimateTokens, utf8Bytes, utf8Slice } from "../contracts.js";
import { authorize } from "./scope.js";
import { decodeCursor, decodeRef, encodeCursor, encodeRef, pageHash, textSourceHash } from "./refs.js";
import type { PctxConfig } from "../config.js";

function blocksOf(entry: NativeEntry): ContentBlock[] {
  const content = entry.message?.content;
  if (Array.isArray(content)) return content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  return [];
}

export function readHistory(input: {
  scope: Scope;
  ref: string;
  cursor?: string | null;
  maxTokens?: number;
  config: PctxConfig;
  getEntry: (id: string) => NativeEntry | undefined;
}): HistoryResult {
  let locator;
  try {
    locator = decodeRef(input.ref);
  } catch {
    return { code: "denied", cursor: null, diagnostic: "invalid ref" };
  }
  if (locator.sessionId !== input.scope.sessionId || locator.workspaceId !== input.scope.workspaceId) {
    return { code: "denied", cursor: null, diagnostic: "scope mismatch" };
  }
  if (!authorize(input.scope, locator.entryId)) {
    return { code: "denied", cursor: null, diagnostic: "not in visible ancestors" };
  }
  const entry = input.getEntry(locator.entryId);
  if (!entry) return { code: "source-missing", cursor: null, diagnostic: "native entry missing" };
  const blocks = blocksOf(entry);
  const block = blocks[locator.field.blockIndex];
  if (!block) return { code: "source-missing", cursor: null, diagnostic: "block missing" };
  if (locator.field.kind === "image") {
    if (block.type !== "image" || typeof block.data !== "string") {
      return { code: "source-missing", cursor: null, diagnostic: "image block missing" };
    }
    return {
      code: "ok",
      image: { type: "image", mimeType: String(block.mimeType ?? "application/octet-stream"), data: block.data },
      cursor: null,
    };
  }
  if (block.type !== "text" || typeof block.text !== "string") {
    return { code: "degraded", cursor: null, diagnostic: "non-text cannot be ranged" };
  }
  const currentHash = textSourceHash(block.text);
  if (currentHash !== locator.sourceHash) {
    return { code: "source-changed", cursor: null, diagnostic: "native source hash changed" };
  }
  const buf = utf8Bytes(block.text);
  let start = 0;
  if (input.cursor) {
    const cur = decodeCursor(input.cursor);
    if (cur.sourceHash !== currentHash) return { code: "stale-cursor", cursor: null, diagnostic: "source changed" };
    start = Number(cur.endByte ?? 0);
  }
  const maxBytes = Math.min(input.config.history.readMaxBytes, buf.length - start);
  const tokenBudget = input.maxTokens ?? input.config.history.readMaxTokens;
  let end = start;
  while (end < start + maxBytes && estimateTokens(buf.subarray(start, end + 1).toString("utf8")) <= tokenBudget) {
    end += 1;
  }
  if (end <= start) return { code: "insufficient-context", cursor: input.cursor ?? encodeCursor({ endByte: start, sourceHash: currentHash }), diagnostic: "no remaining budget" };
  while (end < buf.length && (buf[end] & 0xc0) === 0x80) end += 1;
  const text = utf8Slice(block.text, start, end);
  const next = end < buf.length ? encodeCursor({ endByte: end, sourceHash: currentHash }) : null;
  return {
    code: "ok",
    page: {
      kind: "text-range-exact",
      ref: encodeRef(locator),
      text,
      startByte: start,
      endByteExclusive: end,
      totalBytes: buf.length,
      sourceHash: currentHash,
      pageHash: pageHash(block.text, start, end),
      cursor: next,
      observedAt: new Date().toISOString(),
      currentStateVerified: false,
    },
    cursor: next,
  };
}

export function reassemblePages(pages: Array<{ text: string }>): string {
  return pages.map((p) => p.text).join("");
}
