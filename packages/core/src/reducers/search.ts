import { detailsRecord, rawPointer } from "./text.js";
import type { Reducer, ReducerInput, ReducerOutput } from "./types.js";

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

function dedupeBy<T>(items: T[], keyOf: (item: T) => string): T[] {
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

export function reduceSearchResult(text: string, input: { query: string; rawBlobId?: string }): ReducerOutput {
  const unique = dedupeBy(parsePathLineHits(text), (item) => `${item.path}:${item.line}:${item.text}`);
  const body = unique.slice(0, 80).map((hit) => `${hit.path}:${hit.line}:${hit.text}`);
  return {
    visibleText: [`[search query=${input.query} hits=${unique.length}]`, ...body, `[raw:${rawPointer(input.rawBlobId)}]`].join("\n"),
    facts: unique.map((item) => ({ kind: "search-hit", value: item, authority: "inform" })),
  };
}

export const searchReducer: Reducer = {
  id: "search",
  supports: (input) => /grep|find|search/i.test(input.toolName),
  async reduce(input: ReducerInput) {
    const args = detailsRecord(input.observation.args);
    const query = typeof args.query === "string" ? args.query : input.observation.toolName;
    return reduceSearchResult(input.text, { query, rawBlobId: input.rawBlobId });
  },
};
