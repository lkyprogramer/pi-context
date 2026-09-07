-- Normative minimal DERIVED index. Native Pi entries remain the source of truth.
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
-- Search MUST join current authorized ancestor IDs before ORDER BY/LIMIT.
-- Populate a temporary authorized_entries table from the host Scope per request;
-- never accept these IDs, workspace_id, or session_id from the model.
-- Validate native source_hash again before any exact read.
