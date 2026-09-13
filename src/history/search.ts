import type { HistoryResult, NativeEntry, Scope, SearchHit } from "../contracts.js";
import { estimateTokens, sha256Hex } from "../contracts.js";
import { encodeCursor, decodeCursor, encodeRef } from "./refs.js";
import { resolveIndexedField } from "./sol-pi.js";
import type { HistoryIndex } from "./index.js";
import type { PctxConfig } from "../config.js";
import { SearchSnapshotStore, type SnapshotHit } from "./page-snapshots.js";

function fail(code: HistoryResult["code"], diagnostic: string): HistoryResult {
  return { ok: false, code, cursor: null, nextCursor: null, diagnostic };
}

function encodeSearchCursor(input: {
  snapshotId: string;
  nextOffset: number;
  workspaceId: string;
  sessionId: string;
}): string {
  return encodeCursor({
    v: 6,
    kind: "search",
    snapshotId: input.snapshotId,
    nextOffset: input.nextOffset,
    workspaceId: input.workspaceId,
    sessionId: input.sessionId,
  });
}

function parseSearchCursor(raw: string): {
  snapshotId: string;
  nextOffset: number;
  workspaceId: string;
  sessionId: string;
} | null {
  try {
    const parsed = decodeCursor(raw);
    if (
      parsed.v !== 6 ||
      parsed.kind !== "search" ||
      typeof parsed.snapshotId !== "string" ||
      typeof parsed.workspaceId !== "string" ||
      typeof parsed.sessionId !== "string" ||
      typeof parsed.nextOffset !== "number" ||
      !Number.isInteger(parsed.nextOffset) ||
      parsed.nextOffset < 0
    ) {
      return null;
    }
    return {
      snapshotId: parsed.snapshotId,
      nextOffset: parsed.nextOffset,
      workspaceId: parsed.workspaceId,
      sessionId: parsed.sessionId,
    };
  } catch {
    return null;
  }
}

function pageFromSnapshot(input: {
  snapshot: { snapshotId: string; workspaceId: string; sessionId: string; hits: SnapshotHit[]; truncated: boolean };
  offset: number;
  limit: number;
  scope: Scope;
  config: PctxConfig;
  getEntry: (entryId: string) => NativeEntry | undefined;
}): HistoryResult {
  const hits: SearchHit[] = [];
  let used = 0;
  let scanned = input.offset;
  for (; scanned < input.snapshot.hits.length && hits.length < input.limit; scanned++) {
    const stored = input.snapshot.hits[scanned]!;
    const entry = input.getEntry(stored.entryId);
    if (!entry || !input.scope.visibleEntryIds.has(stored.entryId)) continue;
    const field = resolveIndexedField(input.scope, entry, stored.blockIndex, stored.sourceHash);
    if (!field) continue;
    const excerpt = stored.excerpt;
    const cost = estimateTokens(excerpt) + estimateTokens(stored.ref);
    if (hits.length === 0 && cost > input.config.history.searchMaxTokens) {
      return fail("insufficient-context", "INSUFFICIENT_CONTEXT");
    }
    if (used + cost > input.config.history.searchMaxTokens) break;
    used += cost;
    hits.push({
      ref: stored.ref,
      entryId: stored.entryId,
      excerpt,
      fidelity: "normalized-search-excerpt",
      observedAt: new Date().toISOString(),
      currentStateVerified: false,
    });
  }
  const more = scanned < input.snapshot.hits.length;
  const nextCursor = more
    ? encodeSearchCursor({
        snapshotId: input.snapshot.snapshotId,
        nextOffset: scanned,
        workspaceId: input.snapshot.workspaceId,
        sessionId: input.snapshot.sessionId,
      })
    : null;
  return {
    ok: true,
    code: "ok",
    hits,
    cursor: nextCursor,
    nextCursor,
    diagnostic: input.snapshot.truncated ? "truncated" : undefined,
    details: {
      truncated: input.snapshot.truncated,
      fidelity: "normalized-search-excerpt",
      scope: `${input.scope.workspaceId}/${input.scope.sessionId}`,
    },
  };
}

export async function searchHistory(input: {
  scope: Scope;
  query: string;
  limit?: number;
  cursor?: string | null;
  index: HistoryIndex;
  config: PctxConfig;
  getEntry: (entryId: string) => NativeEntry | undefined;
  snapshots: SearchSnapshotStore;
  nowMs?: number;
  configHash: string;
}): Promise<HistoryResult> {
  if (!input.query || (/[-+^~:]/.test(input.query) && input.query.length > 400)) {
    return fail("denied", "query rejected");
  }
  const nowMs = input.nowMs ?? Date.now();
  const limit = Math.min(input.limit ?? input.config.history.searchLimit, input.config.history.searchLimit);
  const queryHash = sha256Hex(input.query);
  if (input.cursor) {
    const parsed = parseSearchCursor(input.cursor);
    if (!parsed) return fail("stale-cursor", "stale-cursor");
    if (parsed.workspaceId !== input.scope.workspaceId || parsed.sessionId !== input.scope.sessionId) {
      return fail("stale-cursor", "stale-cursor");
    }
    const snapshot = input.snapshots.get(parsed.snapshotId, nowMs);
    if (!snapshot) return fail("stale-cursor", "stale-cursor");
    if (snapshot.queryHash !== queryHash || snapshot.configHash !== input.configHash) {
      return fail("stale-cursor", "stale-cursor");
    }
    if (snapshot.anchorEntryId && !input.scope.visibleEntryIds.has(snapshot.anchorEntryId)) {
      return fail("stale-cursor", "stale-cursor");
    }
    if (parsed.nextOffset > snapshot.hits.length) return fail("stale-cursor", "stale-cursor");
    return pageFromSnapshot({ snapshot, offset: parsed.nextOffset, limit, scope: input.scope, config: input.config, getEntry: input.getEntry });
  }

  let raw;
  try {
    raw = await input.index.search(input.scope, input.query, input.snapshots.maxHits + 1, 0);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "INDEX_UNAVAILABLE") return fail("degraded", "history: unavailable");
    throw err;
  }
  const stored: SnapshotHit[] = [];
  for (const hit of raw) {
    if (stored.length >= input.snapshots.maxHits) break;
    const entry = input.getEntry(hit.entryId);
    if (!entry) continue;
    const field = resolveIndexedField(input.scope, entry, hit.blockIndex, hit.sourceHash);
    if (!field) continue;
    stored.push({
      ref: encodeRef(field),
      entryId: hit.entryId,
      blockIndex: hit.blockIndex,
      sourceHash: field.sourceHash,
      excerpt: hit.excerpt.slice(0, 240),
    });
  }
  const snapshot = input.snapshots.create({
    workspaceId: input.scope.workspaceId,
    sessionId: input.scope.sessionId,
    queryHash,
    configHash: input.configHash,
    anchorEntryId: input.scope.leafId ?? "",
    createdAt: nowMs,
    hits: stored,
    truncated: raw.length > input.snapshots.maxHits,
  });
  return pageFromSnapshot({ snapshot, offset: 0, limit, scope: input.scope, config: input.config, getEntry: input.getEntry });
}
