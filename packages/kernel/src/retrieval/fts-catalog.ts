import { compileSafeFtsQuery, probeFts5, type FtsCapabilities } from "../../../storage/src/fts.js";
import { LiteralIndex, type RetrievalHit } from "./literal-index.js";

export interface CatalogDocument {
  documentId: string;
  workspaceId: string;
  sessionId: string;
  body: string;
  status: string;
  timestamp: number;
}

export interface FtsQuery {
  text: string;
  cursor: { workspaceId: string; sessionId?: string };
  scope?: "workspace" | "session";
  statuses?: string[];
  limit?: number;
}

export class FtsCatalog {
  readonly capabilities: FtsCapabilities;
  private documents: CatalogDocument[] = [];
  private serving: CatalogDocument[] = [];
  private checkpoint = 0;
  private readonly literalFallback = new LiteralIndex();

  constructor(capabilities = probeFts5()) {
    this.capabilities = capabilities;
  }

  static async fixture(): Promise<{
    search(text: string): Promise<RetrievalHit[]>;
    dropServingIndexes(): Promise<void>;
    rebuild(): Promise<void>;
    catalog: FtsCatalog;
  }> {
    const catalog = new FtsCatalog();
    await catalog.upsert({
      documentId: "doc_cache",
      workspaceId: "w1",
      sessionId: "s1",
      body: "cache invalidation strategy",
      status: "active",
      timestamp: 10,
    });
    await catalog.rebuild();
    return {
      catalog,
      search: (text) => catalog.search({ text, cursor: { workspaceId: "w1" }, statuses: ["active"] }),
      dropServingIndexes: () => catalog.dropServingIndexes(),
      rebuild: () => catalog.rebuild(),
    };
  }

  async upsert(doc: CatalogDocument): Promise<void> {
    this.documents = this.documents.filter((item) => item.documentId !== doc.documentId);
    this.documents.push(doc);
    await this.literalFallback.upsert({
      path: doc.documentId,
      status: doc.status,
      evidenceId: doc.documentId,
      observedAt: doc.timestamp,
      text: doc.body,
    });
  }

  async dropServingIndexes(): Promise<void> {
    this.serving = [];
    this.checkpoint = 0;
  }

  async rebuild(signal?: { interruptAfter?: number }): Promise<void> {
    const sorted = [...this.documents].sort((a, b) => a.documentId.localeCompare(b.documentId));
    for (let i = this.checkpoint; i < sorted.length; i += 1) {
      if (signal?.interruptAfter != null && i >= signal.interruptAfter) {
        this.checkpoint = i;
        return;
      }
      this.serving[i] = sorted[i] as CatalogDocument;
      this.checkpoint = i + 1;
    }
  }

  async search(query: FtsQuery): Promise<RetrievalHit[]> {
    if (!this.capabilities.fts5) {
      return this.literalFallback.search({ literal: query.text, statuses: query.statuses });
    }
    const match = compileSafeFtsQuery(query.text).toLowerCase();
    const tokens = match.split(" ").filter(Boolean);
    const rows = this.serving.filter((doc) => {
      if (doc.workspaceId !== query.cursor.workspaceId) return false;
      if (query.scope === "session" && doc.sessionId !== query.cursor.sessionId) return false;
      if (query.statuses && !query.statuses.includes(doc.status)) return false;
      const body = doc.body.toLowerCase();
      return tokens.every((token) => body.includes(token));
    });
    return rows
      .slice(0, query.limit ?? 20)
      .map((doc) => ({
        path: doc.documentId,
        evidenceId: doc.documentId,
        exactness: 1,
        recency: doc.timestamp,
        authorityRank: 1,
        status: doc.status,
      }))
      .sort((a, b) => a.evidenceId.localeCompare(b.evidenceId));
  }
}
