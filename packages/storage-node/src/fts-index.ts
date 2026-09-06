import type { DatabaseSync } from "node:sqlite";
import type { EvidenceRecord, RuntimeCursor } from "@pcr/contracts";
import { SOURCE_ENTRY_REF_PREFIX } from "@pcr/core";
import type { EvidenceFtsIndex, EvidenceQuery, SearchHit } from "@pcr/runtime";

import {
  getWorkspaceSqliteAccess,
  type WorkspaceSqliteAccess,
} from "./internal/sqlite-access.js";
import {
  StorageNodeError,
  type WorkspaceSqliteEvidenceStore,
} from "./sqlite-store.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export type EvidenceFtsErrorCode =
  | "PCR_FTS_CLOSED"
  | "PCR_FTS_DEPENDENCY_MISSING"
  | "PCR_FTS_INPUT_INVALID"
  | "PCR_FTS_SCOPE_MISMATCH"
  | "PCR_FTS_STORAGE_BUSY"
  | "PCR_FTS_STORAGE_FAILURE"
  | "PCR_FTS_UNAVAILABLE";

export class EvidenceFtsError extends Error {
  readonly code: EvidenceFtsErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EvidenceFtsErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "EvidenceFtsError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface OpenWorkspaceEvidenceFtsIndexInput {
  database: WorkspaceSqliteEvidenceStore;
}

interface SearchCacheVersion {
  readonly dataVersion: number;
  readonly totalChanges: number;
}

interface CachedSearch {
  readonly key: string;
  readonly hits: readonly SearchHit[];
}

function failInput(field: string): never {
  throw new EvidenceFtsError("PCR_FTS_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

export function compileSafeFtsQuery(text: string): string {
  return text
    .replace(/["'*^():{}-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => `"${token.replaceAll("\"", "")}"`)
    .join(" AND ");
}

function searchCacheKey(
  cursor: RuntimeCursor,
  text: string,
  limit: number,
  version: SearchCacheVersion,
  viewKey: string,
): string {
  return JSON.stringify([
    cursor.workspaceId,
    cursor.sessionId,
    cursor.leafId,
    cursor.lineageHash,
    cursor.modelKey,
    text,
    limit,
    viewKey,
    version.dataVersion,
    version.totalChanges,
  ]);
}

function viewCacheKey(query: EvidenceQuery): string {
  if (!query.view) return "legacy-cursor";
  const inherited = query.view.inheritedEntryIds ? [...query.view.inheritedEntryIds].sort() : [];
  return JSON.stringify([
    query.view.workspaceId,
    query.view.sessionId,
    query.view.headId,
    [...query.view.ancestorIds].sort(),
    query.view.parentSessionId ?? null,
    inherited,
  ]);
}

function searchWithBranchView(
  db: DatabaseSync,
  match: string,
  cursor: RuntimeCursor,
  limit: number,
  query: EvidenceQuery,
): Array<{ evidence_id: string; kind: string; rank: number; snippet: string }> {
  const view = query.view!;
  const ancestorJson = JSON.stringify([...view.ancestorIds]);
  const inheritedJson = JSON.stringify([...(view.inheritedEntryIds ?? [])]);
  const parentSessionId = view.parentSessionId ?? "";
  return db.prepare(`
    SELECT
      evidence_fts.evidence_id AS evidence_id,
      evidence.kind AS kind,
      bm25(evidence_fts) AS rank,
      snippet(evidence_fts, 1, '', '', '…', 12) AS snippet
    FROM evidence_fts
    JOIN evidence ON evidence.evidence_id = evidence_fts.evidence_id
    WHERE evidence_fts MATCH ?
      AND evidence.workspace_id = ?
      AND (
        (
          evidence.session_id = ?
          AND (
            EXISTS (
              SELECT 1
              FROM json_each(evidence.source_refs_json) AS refs
              JOIN json_each(?) AS ancestors
                ON refs.value = ? || ancestors.value
            )
            OR (
              NOT EXISTS (
                SELECT 1 FROM json_each(evidence.source_refs_json)
                WHERE value LIKE ? || '%'
              )
              AND evidence.leaf_id IS ?
              AND evidence.lineage_hash = ?
              AND evidence.model_key = ?
            )
          )
        )
        OR (
          length(?) > 0
          AND evidence.session_id = ?
          AND EXISTS (
            SELECT 1
            FROM json_each(evidence.source_refs_json) AS refs
            JOIN json_each(?) AS inherited
              ON refs.value = ? || inherited.value
          )
        )
      )
    ORDER BY rank ASC, evidence.evidence_id ASC
    LIMIT ?
  `).all(
    match,
    view.workspaceId,
    view.sessionId,
    ancestorJson,
    SOURCE_ENTRY_REF_PREFIX,
    SOURCE_ENTRY_REF_PREFIX,
    cursor.leafId,
    cursor.lineageHash,
    cursor.modelKey,
    parentSessionId,
    parentSessionId,
    inheritedJson,
    SOURCE_ENTRY_REF_PREFIX,
    limit,
  ) as Array<{ evidence_id: string; kind: string; rank: number; snippet: string }>;
}

function copySearchHits(hits: readonly SearchHit[]): SearchHit[] {
  return hits.map((hit) => ({ ...hit }));
}

function mapStorageError(error: unknown): EvidenceFtsError {
  if (error instanceof EvidenceFtsError) return error;
  if (error instanceof StorageNodeError) {
    if (error.code === "PCR_SQLITE_BUSY" || error.code === "PCR_SQLITE_WRITER_LOCKED") {
      return new EvidenceFtsError("PCR_FTS_STORAGE_BUSY", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_CLOSED") {
      return new EvidenceFtsError("PCR_FTS_CLOSED", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_SCHEMA_DRIFT") {
      return new EvidenceFtsError("PCR_FTS_UNAVAILABLE", {}, { cause: error });
    }
  }
  return new EvidenceFtsError("PCR_FTS_STORAGE_FAILURE", {}, { cause: error });
}

class WorkspaceEvidenceFtsIndex implements EvidenceFtsIndex {
  readonly #database: WorkspaceSqliteAccess;
  #closed = false;
  #latestSearch: CachedSearch | undefined;

  constructor(database: WorkspaceSqliteAccess) {
    this.#database = database;
  }

  async upsert(record: EvidenceRecord, body: string): Promise<void> {
    this.#assertOpen();
    if (!record || typeof record !== "object") failInput("record");
    requireNonEmpty(record.evidenceId, "record.evidenceId");
    if (typeof body !== "string") failInput("body");
    const cursor = snapshotCursor(record.cursor, "record.cursor");
    if (cursor.workspaceId !== this.#database.workspaceId) {
      throw new EvidenceFtsError("PCR_FTS_SCOPE_MISMATCH");
    }
    try {
      this.#database.transaction("upsert-evidence-fts", (db) => {
        db.prepare("DELETE FROM evidence_fts WHERE evidence_id = ?").run(record.evidenceId);
        db.prepare("INSERT INTO evidence_fts(evidence_id, body) VALUES (?, ?)").run(record.evidenceId, body);
      });
      this.#latestSearch = undefined;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async search(query: EvidenceQuery): Promise<SearchHit[]> {
    this.#assertOpen();
    if (!query || typeof query !== "object") failInput("query");
    const cursor = snapshotCursor(query.cursor, "query.cursor");
    if (cursor.workspaceId !== this.#database.workspaceId) {
      throw new EvidenceFtsError("PCR_FTS_SCOPE_MISMATCH");
    }
    requireNonEmpty(query.text, "query.text");
    const match = compileSafeFtsQuery(query.text);
    if (match.length === 0) failInput("query.text");
    const limit = query.limit === undefined ? DEFAULT_LIMIT : query.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) failInput("query.limit");
    query.signal?.throwIfAborted();
    try {
      const version = this.#database.read("check-evidence-fts-version", (db) => {
        const dataVersion = db.prepare("PRAGMA data_version").get() as { data_version: number };
        const totalChanges = db.prepare("SELECT total_changes() AS total_changes").get() as {
          total_changes: number;
        };
        return { dataVersion: dataVersion.data_version, totalChanges: totalChanges.total_changes };
      });
      const key = searchCacheKey(cursor, query.text, limit, version, viewCacheKey(query));
      if (this.#latestSearch?.key === key) return copySearchHits(this.#latestSearch.hits);
      const hits = this.#database.read("search-evidence-fts", (db) => {
        const rows = query.view
          ? searchWithBranchView(db, match, cursor, limit, query)
          : db.prepare(`
          SELECT
            evidence_fts.evidence_id AS evidence_id,
            evidence.kind AS kind,
            bm25(evidence_fts) AS rank,
            snippet(evidence_fts, 1, '', '', '…', 12) AS snippet
          FROM evidence_fts
          JOIN evidence ON evidence.evidence_id = evidence_fts.evidence_id
          WHERE evidence_fts MATCH ?
            AND evidence.workspace_id = ?
            AND evidence.session_id = ?
            AND evidence.leaf_id IS ?
            AND evidence.lineage_hash = ?
            AND evidence.model_key = ?
          ORDER BY rank ASC, evidence.evidence_id ASC
          LIMIT ?
        `).all(
          match,
          cursor.workspaceId,
          cursor.sessionId,
          cursor.leafId,
          cursor.lineageHash,
          cursor.modelKey,
          limit,
        ) as Array<{ evidence_id: string; kind: string; rank: number; snippet: string }>;
        return rows.map((row, index) => ({
          evidenceId: row.evidence_id,
          kind: row.kind,
          rank: typeof row.rank === "number" && Number.isFinite(row.rank) ? row.rank : index,
          ...(typeof row.snippet === "string" && row.snippet.length > 0 ? { snippet: row.snippet } : {}),
        }));
      });
      this.#latestSearch = { key, hits: copySearchHits(hits) };
      return hits;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new EvidenceFtsError("PCR_FTS_CLOSED");
  }
}

export function openWorkspaceEvidenceFtsIndex(
  input: OpenWorkspaceEvidenceFtsIndexInput,
): EvidenceFtsIndex {
  if (!input || typeof input !== "object") failInput("input");
  if (!input.database || typeof input.database !== "object") {
    throw new EvidenceFtsError("PCR_FTS_DEPENDENCY_MISSING", { dependency: "database" });
  }
  let access: WorkspaceSqliteAccess;
  try {
    const ownedAccess = getWorkspaceSqliteAccess(input.database);
    if (!ownedAccess) {
      throw new EvidenceFtsError("PCR_FTS_DEPENDENCY_MISSING", { dependency: "database" });
    }
    access = ownedAccess;
    access.read("open-evidence-fts", (db) => {
      db.prepare("SELECT evidence_id FROM evidence_fts LIMIT 0").all();
    });
  } catch (error) {
    if (error instanceof EvidenceFtsError) throw error;
    if (error instanceof StorageNodeError && error.code === "PCR_SQLITE_INPUT_INVALID") {
      throw new EvidenceFtsError("PCR_FTS_DEPENDENCY_MISSING", { dependency: "database" }, { cause: error });
    }
    const mapped = mapStorageError(error);
    if (mapped.code === "PCR_FTS_STORAGE_FAILURE") {
      throw new EvidenceFtsError("PCR_FTS_UNAVAILABLE", {}, { cause: error });
    }
    throw mapped;
  }
  return new WorkspaceEvidenceFtsIndex(access);
}
