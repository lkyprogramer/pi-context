import type { HistoryResult, NativeEntry, Scope, SearchCursor } from "../contracts.js";
import { estimateTokens, hashCanonical, sha256Hex } from "../contracts.js";
import { encodeCursor, decodeCursor, encodeRef, isFieldRef, refForField } from "./refs.js";
import type { HistoryIndex } from "./index.js";
import type { PctxConfig } from "../config.js";

function branchHash(scope: Scope): string {
  return hashCanonical({ leafId: scope.leafId, ids: [...scope.visibleEntryIds].sort() });
}

function isSearchCursor(value: Record<string, unknown>): boolean {
  return (
    value.v === 6 &&
    typeof value.sessionId === "string" &&
    typeof value.branchHash === "string" &&
    typeof value.queryHash === "string" &&
    typeof value.indexRevision === "string" &&
    typeof value.offset === "number" &&
    Number.isInteger(value.offset) &&
    value.offset >= 0
  );
}

function encodeSearchCursor(cursor: SearchCursor): string {
  return encodeCursor({ ...cursor } as Record<string, unknown>);
}

export async function searchHistory(input: {
  scope: Scope;
  query: string;
  limit?: number;
  cursor?: string | null;
  index: HistoryIndex;
  config: PctxConfig;
  getEntry: (entryId: string) => NativeEntry | undefined;
}): Promise<HistoryResult> {
  if (!input.query || (/[-+^~:]/.test(input.query) && input.query.length > 400)) {
    return { code: "denied", cursor: null, diagnostic: "query rejected" };
  }
  const limit = Math.min(input.limit ?? input.config.history.searchLimit, input.config.history.searchLimit);
  const queryHash = sha256Hex(input.query);
  const indexRevision = await input.index.revision(input.scope);
  const expected: SearchCursor = {
    v: 6,
    sessionId: input.scope.sessionId,
    branchHash: branchHash(input.scope),
    queryHash,
    indexRevision,
    offset: 0,
  };
  let offset = 0;
  let mismatch = false;
  if (input.cursor) {
    try {
      const parsed = decodeCursor(input.cursor);
      if (
        !isSearchCursor(parsed) ||
        parsed.sessionId !== expected.sessionId ||
        parsed.branchHash !== expected.branchHash ||
        parsed.queryHash !== expected.queryHash ||
        parsed.indexRevision !== expected.indexRevision
      ) {
        mismatch = true;
        offset = 0;
      } else {
        offset = Number(parsed.offset);
      }
    } catch {
      mismatch = true;
      offset = 0;
    }
  }
  let raw;
  try {
    raw = await input.index.search(input.scope, input.query, limit, offset);
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code) : "";
    if (code === "INDEX_UNAVAILABLE") {
      return { code: "degraded", cursor: null, diagnostic: "history: unavailable" };
    }
    throw err;
  }
  let used = 0;
  const hits = [];
  for (const hit of raw) {
    const entry = input.getEntry(hit.entryId);
    if (!entry) continue;
    const field = refForField(input.scope, entry, hit.blockIndex);
    if (!isFieldRef(field)) continue;
    const excerpt = hit.excerpt.slice(0, 240);
    used += estimateTokens(excerpt);
    if (used > input.config.history.searchMaxTokens) break;
    hits.push({
      ref: encodeRef(field),
      entryId: hit.entryId,
      excerpt,
      fidelity: "normalized-search-excerpt" as const,
      observedAt: new Date().toISOString(),
      currentStateVerified: false as const,
    });
  }
  const next: SearchCursor | null =
    hits.length === limit
      ? { ...expected, offset: offset + hits.length }
      : null;
  return {
    code: "ok",
    hits,
    cursor: next ? encodeSearchCursor(next) : null,
    diagnostic: mismatch ? "CURSOR_MISMATCH: restarted from offset 0" : undefined,
  };
}
