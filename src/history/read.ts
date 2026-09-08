import type { ContentBlock, HistoryResult, NativeEntry, ReadBudget, Scope } from "../contracts.js";
import { estimateTokens, utf8Bytes } from "../contracts.js";
import { DEFAULT_CONFIG, type PctxConfig } from "../config.js";
import { authorize } from "./scope.js";
import { blocksOf, decodeCursor, decodeRef, encodeCursor, encodeRef, isFieldRef, refForField } from "./refs.js";

export function utf8Prefix(text: string, maxBytes: number): string {
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    const err = new Error("maxBytes must be a nonnegative integer");
    throw err;
  }
  const data = utf8Bytes(text);
  let end = Math.min(maxBytes, data.length);
  while (end > 0 && end < data.length && (data[end]! & 0xc0) === 0x80) end -= 1;
  return data.subarray(0, end).toString("utf8");
}

function fail(code: HistoryResult["code"], diagnostic: string, extra: Partial<HistoryResult> = {}): HistoryResult {
  return { ok: false, code, cursor: null, diagnostic, ...extra };
}

export function readHistory(input: {
  scope: Scope;
  ref: string;
  cursor?: string | null;
  budget?: ReadBudget;
  maxTokens?: number;
  config?: PctxConfig;
  getEntry: (id: string) => NativeEntry | undefined;
}): HistoryResult {
  const config = input.config ?? DEFAULT_CONFIG;
  const budget: ReadBudget = input.budget ?? {
    maxTokens: input.maxTokens ?? config.history.readMaxTokens,
    maxBytes: config.history.readMaxBytes,
    estimateKind: "character-estimate",
  };
  const locator = decodeRef(input.ref);
  if (!isFieldRef(locator)) return fail("denied", locator.code);
  if (locator.sessionId !== input.scope.sessionId || locator.workspaceId !== input.scope.workspaceId) {
    return fail("denied", "scope mismatch");
  }
  if (!authorize(input.scope, locator.entryId)) return fail("denied", "not in visible ancestors");
  const entry = input.getEntry(locator.entryId);
  if (!entry) return fail("source-missing", "native entry missing");
  const recomputed = refForField(input.scope, entry, locator.blockIndex);
  if (!isFieldRef(recomputed)) return fail("source-missing", recomputed.code);
  if (recomputed.sourceHash !== locator.sourceHash || recomputed.kind !== locator.kind) {
    return fail("stale-ref", "STALE_REF");
  }
  const blocks = blocksOf(entry);
  const block = blocks[locator.blockIndex];
  if (!block) return fail("source-missing", "block missing");
  if (locator.kind === "image") {
    if (block.type !== "image" || typeof block.data !== "string") {
      return fail("source-missing", "image block missing");
    }
    const bytes = Buffer.from(block.data, "base64").byteLength;
    if (bytes > Math.min(config.history.readMaxBytes, budget.maxBytes)) {
      return fail("insufficient-context", "INSUFFICIENT_CONTEXT");
    }
    return {
      ok: true,
      code: "ok",
      image: { type: "image", mimeType: String(block.mimeType ?? "application/octet-stream"), data: block.data },
      cursor: null,
      nextCursor: null,
      sourceHash: locator.sourceHash,
      verified: true,
      details: { estimateKind: budget.estimateKind, totalBytes: bytes },
    };
  }
  if (block.type !== "text" || typeof block.text !== "string") {
    return fail("degraded", "non-text cannot be ranged");
  }
  const buf = utf8Bytes(block.text);
  let start = 0;
  if (input.cursor) {
    let cur: Record<string, unknown>;
    try {
      cur = decodeCursor(input.cursor);
    } catch {
      return fail("stale-cursor", "CURSOR_MISMATCH");
    }
    start = Number(cur.byteOffset ?? cur.endByte ?? 0);
    if (!Number.isInteger(start) || start < 0 || start > buf.length) {
      return fail("stale-cursor", "CURSOR_MISMATCH");
    }
    if (start < buf.length && (buf[start]! & 0xc0) === 0x80) {
      return fail("stale-cursor", "CURSOR_MISMATCH");
    }
  }
  if (start === buf.length) {
    return {
      ok: true,
      code: "ok",
      page: "",
      cursor: null,
      nextCursor: null,
      byteOffset: start,
      nextByteOffset: null,
      totalBytes: buf.length,
      sourceHash: locator.sourceHash,
      verified: true,
      details: { estimateKind: budget.estimateKind },
    };
  }
  const cap = Math.min(budget.maxBytes, config.history.readMaxBytes, buf.length - start);
  let text = utf8Prefix(buf.subarray(start).toString("utf8"), cap);
  while (text && estimateTokens(text) > budget.maxTokens) {
    const bytes = Buffer.byteLength(text, "utf8");
    const over = estimateTokens(text) - budget.maxTokens;
    const nextCap = Math.max(0, bytes - Math.max(1, over * 4));
    if (nextCap >= bytes) {
      text = utf8Prefix(buf.subarray(start).toString("utf8"), bytes - 1);
    } else {
      text = utf8Prefix(buf.subarray(start).toString("utf8"), nextCap);
    }
  }
  if (!text) return fail("insufficient-context", "INSUFFICIENT_CONTEXT");
  const end = start + Buffer.byteLength(text, "utf8");
  const nextOffset = end < buf.length ? end : null;
  const nextCursor = nextOffset == null ? null : encodeCursor({ ref: input.ref, byteOffset: nextOffset });
  return {
    ok: true,
    code: "ok",
    page: text,
    cursor: nextCursor,
    nextCursor,
    byteOffset: start,
    nextByteOffset: nextOffset,
    totalBytes: buf.length,
    sourceHash: locator.sourceHash,
    verified: true,
    details: { estimateKind: budget.estimateKind, ref: encodeRef(locator) },
  };
}

export function reassemblePages(pages: Array<string | { text: string }>): string {
  return pages.map((p) => (typeof p === "string" ? p : p.text)).join("");
}

export function formatHistoryResult(r: HistoryResult): { content: ContentBlock[]; details: unknown } {
  const metadataLine = JSON.stringify({
    code: r.code,
    diagnostic: r.diagnostic ?? null,
    byteOffset: r.byteOffset ?? null,
    nextByteOffset: r.nextByteOffset ?? null,
    totalBytes: r.totalBytes ?? null,
    sourceHash: r.sourceHash ?? null,
    verified: r.verified ?? false,
    details: r.details ?? null,
  });
  if (r.image) {
    return {
      content: [
        { type: "text", text: metadataLine },
        { type: "image", mimeType: r.image.mimeType, data: r.image.data },
      ],
      details: r.details ?? r,
    };
  }
  if (typeof r.page === "string") {
    return {
      content: [
        { type: "text", text: metadataLine },
        { type: "text", text: r.page },
      ],
      details: r.details ?? r,
    };
  }
  return {
    content: [{ type: "text", text: JSON.stringify({ code: r.code, hits: r.hits, diagnostic: r.diagnostic }) }],
    details: r.details ?? r,
  };
}
