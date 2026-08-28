import type { ObservationReducer, ReducerOutput } from "./types.js";

export interface PathLineHit {
  path: string;
  line: number;
  text: string;
}

export function parsePathLineHits(text: string): PathLineHit[] {
  const hits: PathLineHit[] = [];
  for (const raw of text.split("\n")) {
    const match = raw.match(/^([^:]+):(\d+):(.*)$/);
    if (!match) continue;
    hits.push({ path: match[1] ?? "", line: Number(match[2]), text: (match[3] ?? "").trim() });
  }
  return hits;
}

export function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function renderBoundedHits(hits: PathLineHit[], opts: { maxHits: number; query: string }): string {
  const body = hits.slice(0, opts.maxHits).map((hit) => `${hit.path}:${hit.line}:${hit.text}`);
  return [`[search query=${opts.query} hits=${hits.length}]`, ...body, "[raw:ctx://observation/raw]"].join("\n");
}

export function reduceSearchResult(text: string, input: { query: string }): ReducerOutput {
  const hits = parsePathLineHits(text);
  const unique = dedupeBy(hits, (item) => `${item.path}:${item.line}:${item.text}`);
  return {
    visibleText: renderBoundedHits(unique, { maxHits: 80, query: input.query }),
    facts: unique.map((item) => ({ kind: "search-hit", value: item, authority: "inform" })),
  };
}

export const searchReducer: ObservationReducer = {
  id: "search",
  revision: "1",
  matches: (input) => /grep|find|search/i.test(input.toolName),
  reduce: async (input) => reduceSearchResult(input.text ?? "", { query: input.toolName }),
};
