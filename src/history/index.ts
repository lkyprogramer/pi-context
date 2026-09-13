import { accessSync, constants, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ERROR, type NativeEntry, type Scope } from "../contracts.js";
import { resolveAgentDir } from "../pi/agent-dir.js";
import { blocksOf, textSourceHash } from "./refs.js";
import { extraIndexedTexts } from "./sol-pi.js";

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

export interface HistoryIndexOptions {
  mode: "persistent" | "memory-only";
  dbPath: string | null;
  maxIndexBytes: number;
}

export interface HistoryIndexStatus {
  mode: string;
  dbPath: string | null;
  rows: number;
  bytes: number;
  lastIndexedLeaf: string | null;
  warnings: string[];
  newRows: number;
  newBytes: number;
  scannedIds: number;
  hashedFields: number;
  physicalBytes: number;
}

export const HISTORY_SEARCH_SQL = `
SELECT b.workspace_id AS workspaceId,
       b.session_id AS sessionId,
       b.entry_id AS entryId,
       b.block_index AS blockIndex,
       b.source_hash AS sourceHash,
       b.tool_name AS toolName,
       snippet(blocks_fts, 0, '', '', '…', 16) AS excerpt,
       bm25(blocks_fts) AS score
FROM blocks_fts
JOIN blocks b ON b.id = blocks_fts.rowid
WHERE b.session_id = ?
  AND b.workspace_id = ?
  AND b.entry_id IN (SELECT entry_id FROM visible_ids)
  AND blocks_fts MATCH ?
ORDER BY bm25(blocks_fts), b.entry_id, b.block_index
LIMIT ? OFFSET ?
`;

const SCHEMA = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  block_index INTEGER NOT NULL,
  source_hash TEXT NOT NULL,
  tool_name TEXT,
  byte_len INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL,
  UNIQUE(workspace_id, session_id, entry_id, block_index)
);
CREATE TABLE IF NOT EXISTS blocks_text (
  id INTEGER PRIMARY KEY,
  text TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  text,
  content='blocks_text',
  content_rowid='id',
  tokenize='unicode61'
);
CREATE TRIGGER IF NOT EXISTS blocks_text_ai AFTER INSERT ON blocks_text BEGIN
  INSERT INTO blocks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS blocks_text_ad AFTER DELETE ON blocks_text BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES('delete', old.id, old.text);
END;
CREATE TABLE IF NOT EXISTS session_leaf (
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  last_indexed_leaf TEXT,
  PRIMARY KEY (workspace_id, session_id)
);
`;

function configError(message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = ERROR.CONFIG;
  throw err;
}

function indexUnavailable(message: string): never {
  const err = new Error(message);
  (err as { code?: string }).code = "INDEX_UNAVAILABLE";
  throw err;
}

export function defaultPersistentPath(agentDir?: string | null): string {
  return join(resolveAgentDir(agentDir), "pctx", "index.sqlite");
}

function resolveDbPath(mode: "persistent" | "memory-only", dbPath: string | null): string {
  if (mode === "memory-only") return ":memory:";
  if (dbPath === ":memory:") configError("persistent storage cannot use :memory:");
  return dbPath ?? defaultPersistentPath();
}

function ensureWritableFilePath(filePath: string): void {
  const dir = dirname(filePath);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  } catch (err) {
    configError(`index dbPath is not writable: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    accessSync(dir, constants.W_OK);
  } catch (err) {
    configError(`index dbPath is not writable: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function shouldIndexEntry(entry: NativeEntry): boolean {
  if (entry.message?.toolName === "pctx_history") return false;
  const role = entry.message?.role;
  return role === "toolResult" || role === "user" || role === "assistant";
}

function ftsPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export class HistoryIndex {
  readonly mode: "persistent" | "memory-only" | "unavailable";
  readonly dbPath: string | null;
  private readonly maxIndexBytes: number;
  private db: DatabaseSync | null;
  private indexFull = false;
  private closed = false;
  private readonly knownEntries = new Set<string>();
  private lastNewRows = 0;
  private lastNewBytes = 0;
  private lastScannedIds = 0;
  private lastHashedFields = 0;
  private sourceChanged = false;

  private constructor(
    mode: "persistent" | "memory-only" | "unavailable",
    dbPath: string | null,
    maxIndexBytes: number,
    db: DatabaseSync | null,
  ) {
    this.mode = mode;
    this.dbPath = dbPath;
    this.maxIndexBytes = maxIndexBytes;
    this.db = db;
    if (db) {
      db.exec("CREATE TEMP TABLE IF NOT EXISTS visible_ids (entry_id TEXT PRIMARY KEY)");
    }
  }

  static open(opts: HistoryIndexOptions): HistoryIndex {
    const dbPath = resolveDbPath(opts.mode, opts.dbPath);
    if (opts.mode === "persistent") ensureWritableFilePath(dbPath);
    let db: DatabaseSync;
    try {
      db = new DatabaseSync(dbPath);
    } catch (err) {
      if (opts.mode === "persistent") {
        configError(`index dbPath is not writable: ${err instanceof Error ? err.message : String(err)}`);
      }
      indexUnavailable(err instanceof Error ? err.message : String(err));
    }
    try {
      db.exec(SCHEMA);
    } catch (err) {
      try {
        db.close();
      } catch {
        /* ignore */
      }
      indexUnavailable(err instanceof Error ? err.message : String(err));
    }
    const index = new HistoryIndex(opts.mode, opts.mode === "memory-only" ? ":memory:" : dbPath, opts.maxIndexBytes, db);
    index.rememberExisting();
    return index;
  }

  static unavailable(message = "INDEX_UNAVAILABLE"): HistoryIndex {
    const idx = new HistoryIndex("unavailable", null, 0, null);
    idx.closed = true;
    void message;
    return idx;
  }

  async upsertBranch(
    scope: Scope,
    entries: readonly NativeEntry[],
    extras?: { sessionDir?: string | null },
  ): Promise<{ inserted: number }> {
    return { inserted: this.upsertBranchSync(scope, entries, extras) };
  }

  upsertBranchSync(
    scope: Scope,
    entries: readonly NativeEntry[],
    extras?: { sessionDir?: string | null },
  ): number {
    const db = this.requireDb();
    this.lastNewRows = 0;
    this.lastNewBytes = 0;
    this.lastScannedIds = 0;
    this.lastHashedFields = 0;
    if (scope.leafId) {
      const prior = db.prepare(
        "SELECT last_indexed_leaf AS leaf FROM session_leaf WHERE workspace_id = ? AND session_id = ?",
      ).get(scope.workspaceId, scope.sessionId) as { leaf: string | null } | undefined;
      if (prior?.leaf === scope.leafId) {
        return this.backfillReducerSources(scope, entries, extras);
      }
    }
    const insertBlock = db.prepare(
      `INSERT OR IGNORE INTO blocks(workspace_id, session_id, entry_id, block_index, source_hash, tool_name, byte_len, indexed_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    const insertText = db.prepare("INSERT INTO blocks_text(id, text) VALUES(?, ?)");
    const existing = db.prepare(
      `SELECT source_hash AS sourceHash FROM blocks
       WHERE workspace_id = ? AND session_id = ? AND entry_id = ? AND block_index = ?`,
    );
    let inserted = 0;
    let pendingExtras = false;
    const now = Date.now();
    let used = this.bytes();
    db.exec("BEGIN");
    try {
      for (const entry of entries) {
        if (!shouldIndexEntry(entry)) continue;
        this.lastScannedIds += 1;
        const knownKey = `${scope.workspaceId}|${scope.sessionId}|${entry.id}`;
        if (this.knownEntries.has(knownKey)) continue;
        const blocks = blocksOf(entry);
        const toolName = entry.message?.toolName ?? null;
        let indexed = true;
        for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
          const block = blocks[blockIndex]!;
          if (block.type !== "text" || typeof block.text !== "string") continue;
          const byteLen = Buffer.byteLength(block.text, "utf8");
          const hash = textSourceHash(block.text);
          this.lastHashedFields += 1;
          const prior = existing.get(scope.workspaceId, scope.sessionId, entry.id, blockIndex) as { sourceHash: string } | undefined;
          if (prior) {
            if (prior.sourceHash !== hash) this.noteSourceChanged();
            continue;
          }
          if (used + byteLen > this.maxIndexBytes) {
            this.indexFull = true;
            indexed = false;
            break;
          }
          const result = insertBlock.run(
            scope.workspaceId,
            scope.sessionId,
            entry.id,
            blockIndex,
            hash,
            toolName,
            byteLen,
            now,
          );
          if (result.changes === 0) continue;
          insertText.run(Number(result.lastInsertRowid), block.text);
          used += byteLen;
          inserted += 1;
          this.lastNewRows += 1;
          this.lastNewBytes += byteLen;
        }
        const extra = extraIndexedTexts(entry, extras?.sessionDir, scope.sessionId);
        if (extra === "pending") {
          indexed = false;
          pendingExtras = true;
        } else if (extra && indexed) {
          const priorExtra = existing.get(scope.workspaceId, scope.sessionId, entry.id, extra.blockIndex) as
            | { sourceHash: string }
            | undefined;
          if (!priorExtra) {
            if (used + extra.bytes > this.maxIndexBytes) {
              this.indexFull = true;
              indexed = false;
            } else {
              const result = insertBlock.run(
                scope.workspaceId,
                scope.sessionId,
                entry.id,
                extra.blockIndex,
                extra.hash,
                toolName,
                extra.bytes,
                now,
              );
              if (result.changes > 0) {
                insertText.run(Number(result.lastInsertRowid), extra.text);
                used += extra.bytes;
                inserted += 1;
                this.lastNewRows += 1;
                this.lastNewBytes += extra.bytes;
              }
            }
          } else if (priorExtra.sourceHash !== extra.hash) {
            this.noteSourceChanged();
          }
        }
        if (indexed) this.knownEntries.add(knownKey);
      }
      if (!this.indexFull && !pendingExtras) {
          db.prepare(
          `INSERT INTO session_leaf(workspace_id, session_id, last_indexed_leaf)
           VALUES(?,?,?)
           ON CONFLICT(workspace_id, session_id) DO UPDATE SET last_indexed_leaf = excluded.last_indexed_leaf`,
        ).run(scope.workspaceId, scope.sessionId, scope.leafId);
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
    return inserted;
  }

  async search(scope: Scope, query: string, limit: number, offset: number): Promise<IndexedHit[]> {
    return this.searchSync(scope, query, limit, offset);
  }

  searchSync(scope: Scope, query: string, limit: number, offset: number): IndexedHit[] {
    const db = this.requireDb();
    const q = query.trim();
    if (!q || limit <= 0) return [];
    db.exec("DELETE FROM visible_ids");
    const insertVisible = db.prepare("INSERT OR IGNORE INTO visible_ids(entry_id) VALUES(?)");
    for (const id of scope.visibleEntryIds) insertVisible.run(id);
    let rows: Array<{
      workspaceId: string;
      sessionId: string;
      entryId: string;
      blockIndex: number;
      sourceHash: string;
      toolName: string | null;
      excerpt: string;
      score: number;
    }> = [];
    try {
      rows = db.prepare(HISTORY_SEARCH_SQL).all(
        scope.sessionId,
        scope.workspaceId,
        ftsPhrase(q),
        Math.max(0, limit),
        Math.max(0, offset),
      ) as typeof rows;
    } catch (err) {
      indexUnavailable(err instanceof Error ? err.message : String(err));
    }
    return rows.map((row) => ({
      workspaceId: String(row.workspaceId),
      sessionId: String(row.sessionId),
      entryId: String(row.entryId),
      blockIndex: Number(row.blockIndex),
      sourceHash: String(row.sourceHash),
      toolName: row.toolName == null ? null : String(row.toolName),
      excerpt: String(row.excerpt ?? ""),
      score: Number(row.score ?? 0),
    }));
  }

  async revision(scope: Scope): Promise<string> {
    return this.revisionSync(scope);
  }

  revisionSync(scope: Scope): string {
    const db = this.requireDb();
    const row = db.prepare(
      "SELECT COALESCE(MAX(indexed_at), 0) AS m, COUNT(*) AS c FROM blocks WHERE workspace_id = ? AND session_id = ?",
    ).get(scope.workspaceId, scope.sessionId) as { m: number; c: number };
    return `${row.m}:${row.c}`;
  }

  async close(): Promise<void> {
    this.closeSync();
  }

  closeSync(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
    this.db = null;
  }

  /** `bytes` is the logical text budget (sum of indexed UTF-8 lengths). `physicalBytes` is the SQLite file size, diagnostic only. Quota never deletes canonical session history. */
  status(): HistoryIndexStatus {
    const warnings: string[] = [];
    if (this.mode === "unavailable") warnings.push("history: unavailable");
    if (this.indexFull) warnings.push("index-full");
    if (this.sourceChanged) warnings.push("source-changed");
    if (this.closed && this.mode !== "unavailable") warnings.push("history: unavailable");
    let lastIndexedLeaf: string | null = null;
    if (this.db) {
      const row = this.db.prepare(
        "SELECT last_indexed_leaf AS leaf FROM session_leaf ORDER BY rowid DESC LIMIT 1",
      ).get() as { leaf: string | null } | undefined;
      lastIndexedLeaf = row?.leaf ?? null;
    }
    return {
      mode: this.mode,
      dbPath: this.dbPath,
      rows: this.rows(),
      bytes: this.bytes(),
      lastIndexedLeaf,
      warnings,
      newRows: this.lastNewRows,
      newBytes: this.lastNewBytes,
      scannedIds: this.lastScannedIds,
      hashedFields: this.lastHashedFields,
      physicalBytes: this.physicalBytes(),
    };
  }

  private backfillReducerSources(
    scope: Scope,
    entries: readonly NativeEntry[],
    extras?: { sessionDir?: string | null },
  ): number {
    if (!extras?.sessionDir) return 0;
    const db = this.requireDb();
    const insertBlock = db.prepare(
      `INSERT OR IGNORE INTO blocks(workspace_id, session_id, entry_id, block_index, source_hash, tool_name, byte_len, indexed_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    );
    const insertText = db.prepare("INSERT INTO blocks_text(id, text) VALUES(?, ?)");
    const existing = db.prepare(
      `SELECT source_hash AS sourceHash FROM blocks
       WHERE workspace_id = ? AND session_id = ? AND entry_id = ? AND block_index = ?`,
    );
    let inserted = 0;
    let pendingExtras = false;
    const now = Date.now();
    let used = this.bytes();
    db.exec("BEGIN");
    try {
      for (const entry of entries) {
        const extra = extraIndexedTexts(entry, extras.sessionDir, scope.sessionId);
        if (extra === "pending") {
          pendingExtras = true;
          continue;
        }
        if (!extra) continue;
        const prior = existing.get(scope.workspaceId, scope.sessionId, entry.id, extra.blockIndex) as
          | { sourceHash: string }
          | undefined;
        if (prior) {
          if (prior.sourceHash !== extra.hash) this.noteSourceChanged();
          this.knownEntries.add(`${scope.workspaceId}|${scope.sessionId}|${entry.id}`);
          continue;
        }
        if (used + extra.bytes > this.maxIndexBytes) {
          this.indexFull = true;
          pendingExtras = true;
          break;
        }
        const result = insertBlock.run(
          scope.workspaceId,
          scope.sessionId,
          entry.id,
          extra.blockIndex,
          extra.hash,
          entry.message?.toolName ?? null,
          extra.bytes,
          now,
        );
        if (result.changes === 0) continue;
        insertText.run(Number(result.lastInsertRowid), extra.text);
        used += extra.bytes;
        inserted += 1;
        this.lastNewRows += 1;
        this.lastNewBytes += extra.bytes;
        this.knownEntries.add(`${scope.workspaceId}|${scope.sessionId}|${entry.id}`);
      }
      if (!this.indexFull && !pendingExtras && scope.leafId) {
        db.prepare(
          `INSERT INTO session_leaf(workspace_id, session_id, last_indexed_leaf)
           VALUES(?,?,?)
           ON CONFLICT(workspace_id, session_id) DO UPDATE SET last_indexed_leaf = excluded.last_indexed_leaf`,
        ).run(scope.workspaceId, scope.sessionId, scope.leafId);
      }
      db.exec("COMMIT");
    } catch (err) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw err;
    }
    return inserted;
  }

  private rememberExisting(): void {
    if (!this.db) return;
    const rows = this.db.prepare(
      "SELECT DISTINCT workspace_id AS workspaceId, session_id AS sessionId, entry_id AS entryId FROM blocks",
    ).all() as Array<{ workspaceId: string; sessionId: string; entryId: string }>;
    for (const row of rows) {
      this.knownEntries.add(`${row.workspaceId}|${row.sessionId}|${row.entryId}`);
    }
  }

  private noteSourceChanged(): void {
    this.sourceChanged = true;
  }

  private physicalBytes(): number {
    if (!this.dbPath || this.dbPath === ":memory:") return 0;
    try {
      return statSync(this.dbPath).size;
    } catch {
      return 0;
    }
  }

  private rows(): number {
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM blocks").get() as { n: number };
    return Number(row.n);
  }

  private bytes(): number {
    if (!this.db) return 0;
    const row = this.db.prepare("SELECT COALESCE(SUM(byte_len), 0) AS n FROM blocks").get() as { n: number };
    return Number(row.n);
  }

  private requireDb(): DatabaseSync {
    if (!this.db || this.mode === "unavailable") indexUnavailable("history: unavailable");
    return this.db;
  }
}

export async function createHistoryIndex(opts: HistoryIndexOptions): Promise<HistoryIndex> {
  return HistoryIndex.open(opts);
}
