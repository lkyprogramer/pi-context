import type { ContentBlock, HistoryResult, NativeEntry, ReadBudget, Scope } from "../contracts.js";
import { DEFAULT_CONFIG, type PctxConfig } from "../config.js";
import { authorize } from "./scope.js";
import { blocksOf, decodeCursor, decodeRef, encodeCursor, encodeRef, isFieldRef, refForField, utf8Prefix } from "./refs.js";
import { loadReducerArchive, receiptOf, sliceUtf8Page, virtualReducerRef } from "./sol-pi.js";

export { utf8Prefix };

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
  sessionDir?: string | null;
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
  const native = refForField(input.scope, entry, locator.blockIndex);
  const virtual = isFieldRef(native) ? null : virtualReducerRef(input.scope, entry, locator.blockIndex);
  const recomputed = isFieldRef(native) ? native : virtual;
  if (!recomputed) return fail("source-missing", isFieldRef(native) ? "block missing" : native.code);
  if (recomputed.sourceHash !== locator.sourceHash || recomputed.kind !== locator.kind) {
    return fail("stale-ref", "STALE_REF");
  }
  const blocks = blocksOf(entry);
  const block = blocks[locator.blockIndex];
  if (locator.kind === "image") {
    if (!block) return fail("source-missing", "block missing");
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
  let body: string | null = null;
  if (block && block.type === "text" && typeof block.text === "string") {
    body = block.text;
  } else if (!block) {
    const receipt = receiptOf(entry);
    const loaded = receipt
      ? loadReducerArchive(input.sessionDir, input.scope.sessionId, receipt, locator.blockIndex)
      : null;
    if (!loaded) return fail("source-missing", "reducer archive missing");
    if (loaded.hash !== locator.sourceHash) return fail("stale-ref", "STALE_REF");
    body = loaded.text;
  } else {
    return fail("degraded", "non-text cannot be ranged");
  }
  let start = 0;
  if (input.cursor) {
    let cur: Record<string, unknown>;
    try {
      cur = decodeCursor(input.cursor);
    } catch {
      return fail("stale-cursor", "stale-cursor");
    }
    if (!readCursorMatches(cur, locator)) return fail("stale-cursor", "stale-cursor");
    start = Number(cur.byteOffset ?? cur.endByte ?? 0);
  }
  const sliced = sliceUtf8Page(body, start, budget, config);
  if (!sliced.ok) return sliced.result;
  const nextOffset = sliced.end < sliced.total ? sliced.end : null;
  const nextCursor =
    nextOffset == null
      ? null
      : encodeCursor({
          v: 6,
          kind: "read",
          workspaceId: locator.workspaceId,
          sessionId: locator.sessionId,
          entryId: locator.entryId,
          blockIndex: locator.blockIndex,
          fieldKind: locator.kind,
          sourceHash: locator.sourceHash,
          byteOffset: nextOffset,
        });
  return {
    ok: true,
    code: "ok",
    page: sliced.page,
    cursor: nextCursor,
    nextCursor,
    byteOffset: sliced.start,
    nextByteOffset: nextOffset,
    totalBytes: sliced.total,
    sourceHash: locator.sourceHash,
    verified: true,
    details: { estimateKind: budget.estimateKind, ref: encodeRef(locator) },
  };
}

export function reassemblePages(pages: Array<string | { text: string }>): string {
  return pages.map((p) => (typeof p === "string" ? p : p.text)).join("");
}

export function formatHistoryResult(r: HistoryResult): { content: ContentBlock[]; details: unknown } {
  const nextCursor = r.nextCursor ?? r.cursor ?? null;
  const metadataLine = JSON.stringify({
    code: r.code,
    diagnostic: r.diagnostic ?? null,
    nextCursor,
    byteOffset: r.byteOffset ?? null,
    nextByteOffset: r.nextByteOffset ?? null,
    totalBytes: r.totalBytes ?? null,
    sourceHash: r.sourceHash ?? null,
    verified: r.verified ?? false,
    hits: r.hits ?? null,
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
    content: [{ type: "text", text: metadataLine }],
    details: r.details ?? r,
  };
}

function readCursorMatches(cur: Record<string, unknown>, locator: { workspaceId: string; sessionId: string; entryId: string; blockIndex: number; kind: string; sourceHash: string }): boolean {
  if (cur.kind != null && cur.kind !== "read") return false;
  const workspaceId = typeof cur.workspaceId === "string" ? cur.workspaceId : null;
  const sessionId = typeof cur.sessionId === "string" ? cur.sessionId : null;
  const entryId = typeof cur.entryId === "string" ? cur.entryId : null;
  const blockIndex = typeof cur.blockIndex === "number" ? cur.blockIndex : null;
  const fieldKind = typeof cur.fieldKind === "string" ? cur.fieldKind : typeof cur.refKind === "string" ? cur.refKind : null;
  const sourceHash = typeof cur.sourceHash === "string" ? cur.sourceHash : null;
  if (workspaceId != null && workspaceId !== locator.workspaceId) return false;
  if (sessionId != null && sessionId !== locator.sessionId) return false;
  if (entryId != null && entryId !== locator.entryId) return false;
  if (blockIndex != null && blockIndex !== locator.blockIndex) return false;
  if (fieldKind != null && fieldKind !== locator.kind) return false;
  if (sourceHash != null && sourceHash !== locator.sourceHash) return false;
  if (typeof cur.ref === "string") {
    const decoded = decodeRef(cur.ref);
    if (isFieldRef(decoded)) {
      return (
        decoded.workspaceId === locator.workspaceId &&
        decoded.sessionId === locator.sessionId &&
        decoded.entryId === locator.entryId &&
        decoded.blockIndex === locator.blockIndex &&
        decoded.kind === locator.kind &&
        decoded.sourceHash === locator.sourceHash
      );
    }
  }
  return workspaceId != null && sessionId != null && entryId != null && blockIndex != null && sourceHash != null;
}
