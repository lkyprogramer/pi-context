import type { HistoryResult, NativeEntry, Scope } from "../contracts.js";
import { estimateTokens } from "../contracts.js";
import { authorizeHits } from "./scope.js";
import { encodeCursor, decodeCursor, encodeRef, isFieldRef, refForField } from "./refs.js";
import type { HistoryIndex } from "./index.js";
import type { PctxConfig } from "../config.js";

export function searchHistory(input: {
  scope: Scope;
  query: string;
  limit?: number;
  cursor?: string | null;
  index: HistoryIndex;
  config: PctxConfig;
  sourceRevision: string;
  getEntry: (entryId: string) => NativeEntry | undefined;
}): HistoryResult {
  if (!input.query || (/[-+^~:]/.test(input.query) && input.query.length > 400)) {
    return { code: "denied", cursor: null, diagnostic: "query rejected" };
  }
  const limit = Math.min(input.limit ?? input.config.history.searchLimit, input.config.history.searchLimit);
  if (input.cursor) {
    const cur = decodeCursor(input.cursor);
    if (cur.sourceRevision !== input.sourceRevision || cur.sessionId !== input.scope.sessionId) {
      return { code: "stale-cursor", cursor: null, diagnostic: "cursor stale after branch/config change" };
    }
  }
  const raw = input.index.search(input.scope, input.query, [...input.scope.visibleEntryIds], 10_000);
  const authorized = authorizeHits(input.scope, raw, limit);
  let used = 0;
  const hits = [];
  for (const hit of authorized) {
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
  return {
    code: "ok",
    hits,
    cursor: encodeCursor({ sourceRevision: input.sourceRevision, sessionId: input.scope.sessionId, offset: hits.length }),
  };
}
