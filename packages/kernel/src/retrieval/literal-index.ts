import { actionAuthorityRank, type ActionAuthority } from "../../../contracts/src/index.js";
import { foldPath, normalizeExactTokens, rejectUnsafeQuery } from "./normalizers.js";

export interface IndexedEvidence {
  path: string;
  status: string;
  evidenceId: string;
  observedAt: number;
  sourceClass?: string;
  authority?: ActionAuthority;
  text?: string;
  kind?: "literal" | "path" | "error" | "command";
}

export interface LiteralSearchQuery {
  literal: string;
  statuses?: string[];
  after?: number;
  before?: number;
  sourceClasses?: string[];
  foldPaths?: boolean;
  signal?: AbortSignal;
}

export interface RetrievalHit {
  path: string;
  evidenceId: string;
  exactness: number;
  recency: number;
  authorityRank: number;
  status: string;
}

function compareTuple(left: Array<number | string>, right: Array<number | string>): number {
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

export class LiteralIndex {
  private readonly records: IndexedEvidence[] = [];

  static async inMemory(): Promise<LiteralIndex> {
    return new LiteralIndex();
  }

  async upsert(record: IndexedEvidence): Promise<void> {
    this.records.push({ ...record, path: foldPath(record.path) });
  }

  async search(query: LiteralSearchQuery): Promise<RetrievalHit[]> {
    if (query.signal?.aborted) throw Object.assign(new Error("PCR_QUERY_CANCELLED"), { code: "PCR_QUERY_CANCELLED" });
    rejectUnsafeQuery(query.literal);
    const tokens = normalizeExactTokens(query.literal);
    const needle = query.foldPaths ? query.literal.toLowerCase() : query.literal;
    const candidates = this.records
      .filter((item) => !query.statuses || query.statuses.includes(item.status))
      .filter((item) => query.after == null || item.observedAt >= query.after)
      .filter((item) => query.before == null || item.observedAt <= query.before)
      .filter((item) => !query.sourceClasses || query.sourceClasses.includes(item.sourceClass ?? ""))
      .filter((item) => {
        const hay = query.foldPaths ? `${item.path} ${item.text ?? ""}`.toLowerCase() : `${item.path} ${item.text ?? ""}`;
        return tokens.some((token) => hay.includes(query.foldPaths ? token.toLowerCase() : token)) || hay.includes(needle);
      })
      .map((item) => ({
        path: item.path,
        evidenceId: item.evidenceId,
        exactness: item.path.endsWith(query.literal) || item.path === query.literal ? 2 : 1,
        recency: item.observedAt,
        authorityRank: actionAuthorityRank(item.authority ?? "inform"),
        status: item.status,
      }));
    return candidates.sort((a, b) =>
      compareTuple(
        [b.exactness, b.recency, b.authorityRank, a.evidenceId],
        [a.exactness, a.recency, a.authorityRank, b.evidenceId],
      ),
    );
  }
}
