import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NativeEntry, Scope } from "../contracts.js";
import { hashCanonical } from "../contracts.js";
import { blocksOf, imageSourceHash, textSourceHash } from "./refs.js";

export interface IndexedHit {
  workspaceId: string;
  sessionId: string;
  entryId: string;
  blockIndex: number;
  sourceHash: string;
  toolName: string | null;
  excerpt: string;
  score: number;
}

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS indexed_text (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  body TEXT NOT NULL,
  tool_name TEXT,
  UNIQUE(workspace_id, session_id, entry_id, block_index)
);
CREATE VIRTUAL TABLE IF NOT EXISTS text_fts USING fts5(body, content='indexed_text', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS indexed_text_ai AFTER INSERT ON indexed_text BEGIN INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body); END;
CREATE TRIGGER IF NOT EXISTS indexed_text_ad AFTER DELETE ON indexed_text BEGIN INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body); END;
CREATE TRIGGER IF NOT EXISTS indexed_text_au AFTER UPDATE ON indexed_text BEGIN
  INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body);
  INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body);
END;
`;

type MemoryRow = {
  workspaceId: string;
  sessionId: string;
  entryId: string;
  blockIndex: number;
  body: string;
  sourceHash: string;
  toolName: string | null;
};

export class HistoryIndex {
  private db: DatabaseSync;
  private memory = new Map<string, MemoryRow>();
  degraded = false;

  constructor(private readonly mode: "persistent" | "memory-only", dbPath = ":memory:") {
    this.db = new DatabaseSync(mode === "memory-only" ? ":memory:" : dbPath);
    try {
      this.db.exec(SCHEMA);
    } catch {
      this.degraded = true;
    }
  }

  sourceRevision(entries: NativeEntry[]): string {
    return hashCanonical(entries.map((e) => e.id));
  }

  upsert(scope: Scope, entry: NativeEntry): void {
    if (entry.message?.toolName === "pctx_history") return;
    if (entry.customType === "pctx.capsule.v5") return;
    const blocks = blocksOf(entry);
    const toolName = entry.message?.toolName ?? null;
    blocks.forEach((block, blockIndex) => {
      let sourceHash: string;
      let body = "";
      if (block.type === "text" && typeof block.text === "string") {
        body = block.text;
        sourceHash = textSourceHash(block.text);
      } else if (block.type === "image") {
        sourceHash = imageSourceHash(block);
      } else {
        return;
      }
      const key = `${scope.workspaceId}:${scope.sessionId}:${entry.id}:${blockIndex}`;
      const row: MemoryRow = {
        workspaceId: scope.workspaceId,
        sessionId: scope.sessionId,
        entryId: entry.id,
        blockIndex,
        body,
        sourceHash,
        toolName,
      };
      this.memory.set(key, row);
      if (this.degraded) return;
      this.db.prepare(
        `INSERT INTO indexed_text(workspace_id,session_id,entry_id,block_index,source_hash,body,tool_name)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,session_id,entry_id,block_index)
         DO UPDATE SET source_hash=excluded.source_hash, body=excluded.body, tool_name=excluded.tool_name`,
      ).run(scope.workspaceId, scope.sessionId, entry.id, blockIndex, sourceHash, body, toolName);
    });
  }

  search(scope: Scope, query: string, authorizedIds: readonly string[], limit: number): IndexedHit[] {
    const allowed = new Set(authorizedIds);
    const q = query.toLowerCase();
    const hits: IndexedHit[] = [];
    for (const row of this.memory.values()) {
      if (row.sessionId !== scope.sessionId || row.workspaceId !== scope.workspaceId) continue;
      if (!allowed.has(row.entryId)) continue;
      if (row.toolName === "pctx_history") continue;
      if (!row.body) continue;
      const haystack = row.body.toLowerCase();
      if (q && !haystack.includes(q)) continue;
      hits.push({
        workspaceId: row.workspaceId,
        sessionId: row.sessionId,
        entryId: row.entryId,
        blockIndex: row.blockIndex,
        sourceHash: row.sourceHash,
        toolName: row.toolName,
        excerpt: row.body.slice(0, 80),
        score: q ? 1 : 0,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId) || a.blockIndex - b.blockIndex);
    return hits.slice(0, limit);
  }

  workerPath(): string {
    return join(dirname(fileURLToPath(import.meta.url)), "sqlite-worker.js");
  }

  spawnWorker(dbPath: string): Worker {
    return new Worker(this.workerPath(), { workerData: { dbPath } });
  }
}
