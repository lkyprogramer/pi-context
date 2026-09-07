import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { NativeEntry, Scope } from "../contracts.js";
import { hashCanonical } from "../contracts.js";
import { textSourceHash } from "./refs.js";

export interface IndexedHit {
  entryId: string;
  excerpt: string;
  score: number;
}

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS source_entries (
  workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, entry_id TEXT NOT NULL,
  parent_id TEXT, source_hash TEXT NOT NULL, entry_kind TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, session_id, entry_id)
);
CREATE TABLE IF NOT EXISTS indexed_text (
  id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL, field_key TEXT NOT NULL, body TEXT NOT NULL, source_hash TEXT NOT NULL,
  UNIQUE(workspace_id, session_id, entry_id, field_key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS text_fts USING fts5(body, content='indexed_text', content_rowid='id', tokenize='unicode61');
CREATE TRIGGER IF NOT EXISTS indexed_text_ai AFTER INSERT ON indexed_text BEGIN INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body); END;
CREATE TRIGGER IF NOT EXISTS indexed_text_ad AFTER DELETE ON indexed_text BEGIN INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body); END;
CREATE TRIGGER IF NOT EXISTS indexed_text_au AFTER UPDATE ON indexed_text BEGIN
  INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body);
  INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body);
END;
`;

export class HistoryIndex {
  private db: DatabaseSync;
  private memory = new Map<string, { entryId: string; body: string; fieldKey: string; sourceHash: string }>();
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
    const content = entry.message?.content;
    const blocks = Array.isArray(content) ? content : content ? [{ type: "text", text: String(content) }] : [];
    blocks.forEach((block, i) => {
      if (block.type !== "text" || typeof block.text !== "string") return;
      if (entry.customType === "pctx.capsule.v5") return;
      const fieldKey = `text:${i}`;
      const sourceHash = textSourceHash(block.text);
      const key = `${scope.workspaceId}:${scope.sessionId}:${entry.id}:${fieldKey}`;
      this.memory.set(key, { entryId: entry.id, body: block.text, fieldKey, sourceHash });
      if (this.degraded) return;
      this.db.prepare(
        `INSERT INTO source_entries(workspace_id,session_id,entry_id,parent_id,source_hash,entry_kind,observed_at)
         VALUES(?,?,?,?,?,?,?) ON CONFLICT(workspace_id,session_id,entry_id) DO UPDATE SET source_hash=excluded.source_hash`,
      ).run(scope.workspaceId, scope.sessionId, entry.id, entry.parentId, sourceHash, entry.type, new Date().toISOString());
      this.db.prepare(
        `INSERT INTO indexed_text(workspace_id,session_id,entry_id,field_key,body,source_hash)
         VALUES(?,?,?,?,?,?) ON CONFLICT(workspace_id,session_id,entry_id,field_key) DO UPDATE SET body=excluded.body, source_hash=excluded.source_hash`,
      ).run(scope.workspaceId, scope.sessionId, entry.id, fieldKey, block.text, sourceHash);
    });
  }

  search(scope: Scope, query: string, authorizedIds: readonly string[], limit: number): IndexedHit[] {
    const allowed = new Set(authorizedIds);
    const q = query.toLowerCase();
    const hits: IndexedHit[] = [];
    for (const row of this.memory.values()) {
      if (!allowed.has(row.entryId)) continue;
      if (row.fieldKey.startsWith("pctx_history") || row.fieldKey.startsWith("capsule")) continue;
      const idx = row.body.toLowerCase().indexOf(q);
      if (q && idx < 0) continue;
      hits.push({
        entryId: row.entryId,
        excerpt: row.body.slice(Math.max(0, idx), Math.max(0, idx) + 80),
        score: idx < 0 ? 0 : 100 - idx,
      });
    }
    hits.sort((a, b) => b.score - a.score || a.entryId.localeCompare(b.entryId));
    return hits.slice(0, limit);
  }

  workerPath(): string {
    return join(dirname(fileURLToPath(import.meta.url)), "sqlite-worker.js");
  }

  spawnWorker(dbPath: string): Worker {
    return new Worker(this.workerPath(), { workerData: { dbPath } });
  }
}
