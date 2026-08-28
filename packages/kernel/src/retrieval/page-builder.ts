export interface RecallItem {
  evidenceId: string;
  quote: string;
  path?: string;
  recentlyInjected?: boolean;
  tokens: number;
  status?: string;
  observedAt?: number;
  required?: boolean;
}

export interface RetrievalPage {
  items: RecallItem[];
  omitted: Array<{ evidenceId: string; reason: string }>;
  query: unknown;
  abstained?: boolean;
}

export function selectUnderBudget(items: RecallItem[], maxTokens: number): RecallItem[] {
  const selected: RecallItem[] = [];
  let used = 0;
  const required = items.filter((item) => item.required);
  const optional = items.filter((item) => !item.required);
  for (const item of [...required, ...optional]) {
    if (used + item.tokens > maxTokens && !item.required) continue;
    selected.push(item);
    used += item.tokens;
  }
  return selected;
}

export function buildRetrievalPage(query: unknown, selected: RecallItem[], all: RecallItem[] = selected): RetrievalPage {
  const kept = new Set(selected.map((item) => item.evidenceId));
  return {
    items: selected,
    omitted: all.filter((item) => !kept.has(item.evidenceId)).map((item) => ({ evidenceId: item.evidenceId, reason: "budget" })),
    query,
    abstained: selected.length === 0,
  };
}
