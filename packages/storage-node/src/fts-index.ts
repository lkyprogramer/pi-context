import type { EvidenceRecord, RuntimeCursor } from "@pcr/contracts";
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
      return this.#database.read("search-evidence-fts", (db) => {
        const rows = db.prepare(`
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
