import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=1000;
CREATE TABLE IF NOT EXISTS source_entries (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  parent_id TEXT,
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
  entry_kind TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(workspace_id, session_id, entry_id)
);
CREATE TABLE IF NOT EXISTS indexed_text (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  field_key TEXT NOT NULL,
  body TEXT NOT NULL,
  source_hash TEXT NOT NULL CHECK(length(source_hash)=64),
  UNIQUE(workspace_id, session_id, entry_id, field_key),
  FOREIGN KEY(workspace_id,session_id,entry_id)
    REFERENCES source_entries(workspace_id,session_id,entry_id) ON DELETE CASCADE
);
CREATE VIRTUAL TABLE IF NOT EXISTS text_fts USING fts5(
  body, content='indexed_text', content_rowid='id', tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS indexed_text_ai AFTER INSERT ON indexed_text BEGIN
  INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body);
END;
CREATE TRIGGER IF NOT EXISTS indexed_text_ad AFTER DELETE ON indexed_text BEGIN
  INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body);
END;
CREATE TRIGGER IF NOT EXISTS indexed_text_au AFTER UPDATE ON indexed_text BEGIN
  INSERT INTO text_fts(text_fts,rowid,body) VALUES('delete',old.id,old.body);
  INSERT INTO text_fts(rowid,body) VALUES(new.id,new.body);
END;
CREATE TABLE IF NOT EXISTS index_cursors (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  last_entry_id TEXT,
  PRIMARY KEY(workspace_id,session_id)
);
`;

const dbPath = String((workerData as { dbPath?: string })?.dbPath ?? ":memory:");
if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(dbPath);
db.exec(SCHEMA);

parentPort?.on("message", (msg: { id: number; op: string; payload?: Record<string, unknown> }) => {
  try {
    if (msg.op === "upsert") {
      const p = msg.payload!;
      db.prepare(
        `INSERT INTO source_entries(workspace_id,session_id,entry_id,parent_id,source_hash,entry_kind,observed_at)
         VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(workspace_id,session_id,entry_id) DO UPDATE SET source_hash=excluded.source_hash, parent_id=excluded.parent_id`,
      ).run(
        String(p.workspaceId),
        String(p.sessionId),
        String(p.entryId),
        p.parentId == null ? null : String(p.parentId),
        String(p.sourceHash),
        String(p.entryKind),
        String(p.observedAt),
      );
      db.prepare(
        `INSERT INTO indexed_text(workspace_id,session_id,entry_id,field_key,body,source_hash)
         VALUES(?,?,?,?,?,?)
         ON CONFLICT(workspace_id,session_id,entry_id,field_key) DO UPDATE SET body=excluded.body, source_hash=excluded.source_hash`,
      ).run(String(p.workspaceId), String(p.sessionId), String(p.entryId), String(p.fieldKey), String(p.body), String(p.sourceHash));
      parentPort?.postMessage({ id: msg.id, ok: true });
      return;
    }
    if (msg.op === "search") {
      const p = msg.payload!;
      const ids = p.authorizedIds as string[];
      if (!ids.length) {
        parentPort?.postMessage({ id: msg.id, ok: true, rows: [] });
        return;
      }
      const placeholders = ids.map(() => "?").join(",");
      const q = String(p.query ?? "").replace(/['"*]/g, " ").slice(0, 200);
      const rows = db.prepare(
        `SELECT i.entry_id as entryId, snippet(text_fts, 0, '', '', '…', 12) as excerpt
         FROM text_fts
         JOIN indexed_text i ON i.id = text_fts.rowid
         WHERE text_fts MATCH ? AND i.workspace_id = ? AND i.session_id = ?
           AND i.entry_id IN (${placeholders})
           AND i.field_key NOT LIKE 'pctx_history%'
           AND i.field_key NOT LIKE 'capsule%'
         LIMIT ?`,
      ).all(q || '""', String(p.workspaceId), String(p.sessionId), ...ids, Number(p.limit)) as Array<Record<string, unknown>>;
      parentPort?.postMessage({ id: msg.id, ok: true, rows });
      return;
    }
    parentPort?.postMessage({ id: msg.id, ok: false, error: "unknown op" });
  } catch (error) {
    parentPort?.postMessage({ id: msg.id, ok: false, error: String(error) });
  }
});
