import { buildRetrievalPage, selectUnderBudget, type RecallItem, type RetrievalPage } from "./page-builder.js";

export interface ProactiveRecallInput {
  userText: string;
  activePaths: string[];
  errorIds?: string[];
  directives: Array<{ quote: string; kind?: string }>;
  maxTokens: number;
}

export interface ProactiveRecallQuery {
  text: string;
  paths: string[];
  directiveQuotes: string[];
}

export interface RecallDeps {
  catalog: { search(query: ProactiveRecallQuery): Promise<RecallItem[]> };
  injectionHistory: { isRecent(evidenceId: string): boolean };
  pages: { build(query: ProactiveRecallQuery, selected: RecallItem[], all?: RecallItem[]): RetrievalPage };
}

export function deriveQueryFrom(input: ProactiveRecallInput): ProactiveRecallQuery {
  return {
    text: [input.userText, ...input.activePaths, ...(input.errorIds ?? [])].join(" "),
    paths: input.activePaths,
    directiveQuotes: input.directives.map((item) => item.quote),
  };
}

export async function buildProactiveRecallPage(input: ProactiveRecallInput, deps: RecallDeps): Promise<RetrievalPage> {
  const query = deriveQueryFrom(input);
  const hits = await deps.catalog.search(query);
  const required = input.directives.map((directive, index) => ({
    evidenceId: `directive_${index}`,
    quote: directive.quote,
    tokens: Math.max(8, Math.ceil(directive.quote.length / 4)),
    required: true,
    recentlyInjected: false,
    status: "active",
  }));
  const recalled = hits.filter((item) => !deps.injectionHistory.isRecent(item.evidenceId)).map((item) => ({
    ...item,
    recentlyInjected: false,
  }));
  const merged = dedupe([...required, ...recalled]);
  if (merged.length === 0) return { items: [], omitted: [], query, abstained: true };
  const selected = selectUnderBudget(merged, input.maxTokens);
  return deps.pages.build(query, selected, merged);
}

function dedupe(items: RecallItem[]): RecallItem[] {
  const seen = new Set<string>();
  const out: RecallItem[] = [];
  for (const item of items) {
    if (seen.has(item.evidenceId)) continue;
    seen.add(item.evidenceId);
    out.push(item);
  }
  return out;
}
