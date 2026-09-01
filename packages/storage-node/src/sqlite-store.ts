import { mkdirSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  SOURCE_CLASSES,
  canonicalJson,
  domainHash,
  isBlobId,
  type ActionAuthority,
  type BlobRef,
  type EvidenceRecord,
  type RuntimeCursor,
  type SourceClass,
} from "@pcr/contracts";

import {
  WORKSPACE_SQLITE_MIGRATIONS,
  WORKSPACE_SQLITE_SCHEMA_VERSION,
  type WorkspaceSqliteMigration,
} from "./schema/migrations.js";
import { CompactionJournalError } from "@pcr/runtime";
import { registerWorkspaceSqliteAccess } from "./internal/sqlite-access.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AUTHORITIES = new Set<ActionAuthority>(["none", "inform", "propose", "act"]);
const SOURCE_CLASS_SET = new Set<SourceClass>(SOURCE_CLASSES);
const OPEN_PATHS = new Set<string>();

export interface EvidenceRepository {
  put(record: EvidenceRecord): Promise<void>;
  get(cursor: RuntimeCursor, id: string): Promise<EvidenceRecord | null>;
}

export interface OpenWorkspaceSqliteStoreInput {
  dataRoot: string;
  workspaceId: string;
  /** Required finite SQLite lock wait; accepted range is 0..5000 ms. */
  busyTimeoutMs: number;
  /** Admission cancellation only. DatabaseSync cannot interrupt an in-flight SQLite statement. */
  signal?: AbortSignal;
}

export type StorageNodeErrorCode =
  | "PCR_SQLITE_BUSY"
  | "PCR_SQLITE_CLOSED"
  | "PCR_SQLITE_EVIDENCE_CONFLICT"
  | "PCR_SQLITE_FAILURE"
  | "PCR_SQLITE_INPUT_INVALID"
  | "PCR_SQLITE_IO"
  | "PCR_SQLITE_SCHEMA_DRIFT"
  | "PCR_SQLITE_WORKSPACE_MISMATCH"
  | "PCR_SQLITE_WRITER_LOCKED";

export class StorageNodeError extends Error {
  readonly code: StorageNodeErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StorageNodeErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "StorageNodeError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

interface EvidenceRow {
  evidence_id: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  operation_id: string;
  observation_id: string;
  raw_blob_id: string;
  reducer_id: string;
  reducer_revision: string;
  kind: string;
  value_json: string;
  source_class: SourceClass;
  authority: ActionAuthority;
  source_refs_json: string;
  validity_json: string;
  content_hash: string;
  observed_at: number;
}

interface NormalizedEvidence {
  record: EvidenceRecord;
  valueJson: string;
  sourceRefsJson: string;
  validityJson: string;
}

function failInput(field: string): never {
  throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireBlobRef(value: unknown, field: string): asserts value is BlobRef {
  if (!isBlobId(value)) failInput(field);
}

function validateCursor(cursor: RuntimeCursor): RuntimeCursor {
  if (!cursor || typeof cursor !== "object") failInput("cursor");
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput("cursor.workspaceId");
  requireNonEmpty(cursor.sessionId, "cursor.sessionId");
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, "cursor.leafId");
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput("cursor.lineageHash");
  requireNonEmpty(cursor.modelKey, "cursor.modelKey");
  return cursor;
}

function normalizeEvidence(record: EvidenceRecord): NormalizedEvidence {
  if (!record || typeof record !== "object") failInput("record");
  validateCursor(record.cursor);
  requireNonEmpty(record.evidenceId, "record.evidenceId");
  requireNonEmpty(record.operationId, "record.operationId");
  requireNonEmpty(record.observationId, "record.observationId");
  requireBlobRef(record.rawBlobId, "record.rawBlobId");
  requireNonEmpty(record.reducer?.id, "record.reducer.id");
  requireNonEmpty(record.reducer?.revision, "record.reducer.revision");
  requireNonEmpty(record.kind, "record.kind");
  if (!SOURCE_CLASS_SET.has(record.sourceClass)) failInput("record.sourceClass");
  if (!AUTHORITIES.has(record.authority)) failInput("record.authority");
  if (!Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0) failInput("record.sourceRefs");
  for (const sourceRef of record.sourceRefs) requireNonEmpty(sourceRef, "record.sourceRefs[]");
  if (!record.validity || typeof record.validity !== "object") failInput("record.validity");
  requireNonEmpty(record.validity.kind, "record.validity.kind");
  if (
    record.validity.at !== undefined &&
    (!Number.isSafeInteger(record.validity.at) || record.validity.at < 0)
  ) {
    failInput("record.validity.at");
  }
  if (!SHA256_PATTERN.test(record.contentHash)) failInput("record.contentHash");
  if (!Number.isSafeInteger(record.observedAt) || record.observedAt < 0) failInput("record.observedAt");
  let valueJson: string;
  let sourceRefsJson: string;
  let validityJson: string;
  try {
    valueJson = canonicalJson(record.value);
    sourceRefsJson = canonicalJson(record.sourceRefs);
    validityJson = canonicalJson(record.validity);
  } catch (error) {
    throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "record.canonicalJson" }, { cause: error });
  }
  return { record, valueJson, sourceRefsJson, validityJson };
}

function migrationChecksum(migration: WorkspaceSqliteMigration): string {
  return domainHash("storage-node-migration", {
    name: migration.name,
    sql: migration.sql,
    version: migration.version,
  });
}

function mapSqliteError(error: unknown, stage: string): StorageNodeError {
  if (error instanceof StorageNodeError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const nativeCode =
    error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  if (nativeCode?.includes("BUSY") || nativeCode?.includes("LOCKED")) {
    return new StorageNodeError("PCR_SQLITE_BUSY", { nativeCode, stage }, { cause: error });
  }
  if (
    nativeCode?.includes("CANTOPEN") ||
    nativeCode?.includes("IOERR") ||
    nativeCode?.includes("READONLY") ||
    nativeCode?.includes("PERM") ||
    nativeCode?.includes("FULL") ||
    /unable to open|no such file|not a directory|read-only|permission denied|no space|disk (?:I\/O|full)/iu.test(message)
  ) {
    return new StorageNodeError("PCR_SQLITE_IO", { nativeCode, stage }, { cause: error });
  }
  if (/SQLITE_(?:BUSY|LOCKED)|database (?:is )?(?:busy|locked)/iu.test(message)) {
    return new StorageNodeError("PCR_SQLITE_BUSY", { nativeCode, stage }, { cause: error });
  }
  return new StorageNodeError("PCR_SQLITE_FAILURE", { nativeCode, stage }, { cause: error });
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK");
  } catch {
    // The original transaction failure is the authoritative error.
  }
}

function applyMigrations(db: DatabaseSync, appliedAt: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT
  `);
  const appliedRows = db.prepare(
    "SELECT version, name, checksum FROM schema_migration ORDER BY version",
  ).all() as Array<{ version: number; name: string; checksum: string }>;
  for (const [index, applied] of appliedRows.entries()) {
    const expected = WORKSPACE_SQLITE_MIGRATIONS[index];
    if (!expected || applied.version !== expected.version) {
      throw new StorageNodeError("PCR_SQLITE_SCHEMA_DRIFT", {
        actualVersion: applied.version,
        expectedVersion: expected?.version ?? null,
        supportedVersion: WORKSPACE_SQLITE_SCHEMA_VERSION,
      });
    }
    const expectedChecksum = migrationChecksum(expected);
    if (applied.name !== expected.name || applied.checksum !== expectedChecksum) {
      throw new StorageNodeError("PCR_SQLITE_SCHEMA_DRIFT", {
        version: expected.version,
        expectedName: expected.name,
        actualName: applied.name,
        expectedChecksum,
        actualChecksum: applied.checksum,
      });
    }
  }
  for (const [offset, migration] of WORKSPACE_SQLITE_MIGRATIONS.slice(appliedRows.length).entries()) {
    const expectedVersion = appliedRows.length + offset + 1;
    if (migration.version !== expectedVersion) {
      throw new StorageNodeError("PCR_SQLITE_SCHEMA_DRIFT", {
        expectedVersion,
        actualVersion: migration.version,
      });
    }
    db.exec(migration.sql);
    db.prepare(
      "INSERT INTO schema_migration(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)",
    ).run(migration.version, migration.name, migrationChecksum(migration), appliedAt);
  }
}

function initializeWorkspace(db: DatabaseSync, workspaceId: string, now: number): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    applyMigrations(db, now);
    const row = db.prepare("SELECT workspace_id FROM workspace_meta WHERE singleton = 1").get() as
      | { workspace_id: string }
      | undefined;
    if (row && row.workspace_id !== workspaceId) {
      throw new StorageNodeError("PCR_SQLITE_WORKSPACE_MISMATCH", {
        actualWorkspaceId: workspaceId,
        expectedWorkspaceId: row.workspace_id,
      });
    }
    if (!row) {
      db.prepare("INSERT INTO workspace_meta(singleton, workspace_id, created_at) VALUES (1, ?, ?)").run(
        workspaceId,
        now,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
}

function assertMigrationPlan(): void {
  const names = new Set<string>();
  for (const [index, migration] of WORKSPACE_SQLITE_MIGRATIONS.entries()) {
    if (migration.version !== index + 1 || names.has(migration.name)) {
      throw new StorageNodeError("PCR_SQLITE_SCHEMA_DRIFT", {
        expectedVersion: index + 1,
        actualVersion: migration.version,
        duplicateName: names.has(migration.name) ? migration.name : null,
      });
    }
    names.add(migration.name);
  }
}

function rowMatches(row: EvidenceRow, normalized: NormalizedEvidence): boolean {
  const record = normalized.record;
  return (
    row.workspace_id === record.cursor.workspaceId &&
    row.session_id === record.cursor.sessionId &&
    row.leaf_id === record.cursor.leafId &&
    row.lineage_hash === record.cursor.lineageHash &&
    row.model_key === record.cursor.modelKey &&
    row.operation_id === record.operationId &&
    row.observation_id === record.observationId &&
    row.raw_blob_id === record.rawBlobId &&
    row.reducer_id === record.reducer.id &&
    row.reducer_revision === record.reducer.revision &&
    row.kind === record.kind &&
    row.value_json === normalized.valueJson &&
    row.source_class === record.sourceClass &&
    row.authority === record.authority &&
    row.source_refs_json === normalized.sourceRefsJson &&
    row.validity_json === normalized.validityJson &&
    row.content_hash === record.contentHash &&
    row.observed_at === record.observedAt
  );
}

function toEvidenceRecord(row: EvidenceRow): EvidenceRecord {
  requireBlobRef(row.raw_blob_id, "row.raw_blob_id");
  return {
    evidenceId: row.evidence_id,
    cursor: {
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      leafId: row.leaf_id,
      lineageHash: row.lineage_hash,
      modelKey: row.model_key,
    },
    operationId: row.operation_id,
    observationId: row.observation_id,
    rawBlobId: row.raw_blob_id,
    reducer: { id: row.reducer_id, revision: row.reducer_revision },
    kind: row.kind,
    value: JSON.parse(row.value_json) as unknown,
    sourceClass: row.source_class,
    authority: row.authority,
    sourceRefs: JSON.parse(row.source_refs_json) as string[],
    validity: JSON.parse(row.validity_json) as EvidenceRecord["validity"],
    contentHash: row.content_hash,
    observedAt: row.observed_at,
  };
}

const EVIDENCE_COLUMNS = `
  evidence_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
  operation_id, observation_id, raw_blob_id, reducer_id, reducer_revision,
  kind, value_json, source_class, authority, source_refs_json, validity_json,
  content_hash, observed_at
`;

export interface WorkspaceSqliteEvidenceStore extends EvidenceRepository {
  readonly path: string;
  readonly workspaceId: string;
  getSchemaVersion(): number;
  close(): Promise<void>;
}

class WorkspaceSqliteEvidenceStoreImpl implements WorkspaceSqliteEvidenceStore {
  readonly path: string;
  readonly workspaceId: string;
  readonly #db: DatabaseSync;
  #closed = false;

  constructor(db: DatabaseSync, path: string, workspaceId: string) {
    if (!db || !(db instanceof DatabaseSync)) failInput("db");
    requireNonEmpty(path, "path");
    if (!WORKSPACE_PATTERN.test(workspaceId)) failInput("workspaceId");
    this.#db = db;
    this.path = path;
    this.workspaceId = workspaceId;
    registerWorkspaceSqliteAccess(this, {
      path,
      workspaceId,
      read: <T>(stage: string, work: (database: DatabaseSync) => T): T => {
        this.#assertOpen();
        try {
          const result = work(this.#db);
          if (result && typeof result === "object" && "then" in result) {
            throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "read.work.async" });
          }
          return result;
        } catch (error) {
          if (error instanceof CompactionJournalError) throw error;
          throw mapSqliteError(error, stage);
        }
      },
      transaction: <T>(stage: string, work: (database: DatabaseSync) => T): T => {
        this.#assertOpen();
        try {
          this.#db.exec("BEGIN IMMEDIATE");
          const result = work(this.#db);
          if (result && typeof result === "object" && "then" in result) {
            throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "transaction.work.async" });
          }
          this.#db.exec("COMMIT");
          return result;
        } catch (error) {
          rollback(this.#db);
          if (error instanceof CompactionJournalError) throw error;
          throw mapSqliteError(error, stage);
        }
      },
    });
  }

  async put(record: EvidenceRecord): Promise<void> {
    this.#assertOpen();
    const normalized = normalizeEvidence(record);
    if (record.cursor.workspaceId !== this.workspaceId) {
      throw new StorageNodeError("PCR_SQLITE_WORKSPACE_MISMATCH", {
        actualWorkspaceId: record.cursor.workspaceId,
        expectedWorkspaceId: this.workspaceId,
      });
    }
    try {
      this.#db.exec("BEGIN IMMEDIATE");
      const existing = this.#db.prepare(`SELECT ${EVIDENCE_COLUMNS} FROM evidence WHERE evidence_id = ?`).get(
        record.evidenceId,
      ) as unknown as EvidenceRow | undefined;
      if (existing) {
        if (!rowMatches(existing, normalized)) {
          throw new StorageNodeError("PCR_SQLITE_EVIDENCE_CONFLICT", { evidenceId: record.evidenceId });
        }
        this.#db.exec("COMMIT");
        return;
      }
      this.#db.prepare(`
        INSERT INTO evidence (${EVIDENCE_COLUMNS})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.evidenceId,
        record.cursor.workspaceId,
        record.cursor.sessionId,
        record.cursor.leafId,
        record.cursor.lineageHash,
        record.cursor.modelKey,
        record.operationId,
        record.observationId,
        record.rawBlobId,
        record.reducer.id,
        record.reducer.revision,
        record.kind,
        normalized.valueJson,
        record.sourceClass,
        record.authority,
        normalized.sourceRefsJson,
        normalized.validityJson,
        record.contentHash,
        record.observedAt,
      );
      this.#db.exec("COMMIT");
    } catch (error) {
      rollback(this.#db);
      throw mapSqliteError(error, "put-evidence");
    }
  }

  async get(cursorInput: RuntimeCursor, id: string): Promise<EvidenceRecord | null> {
    this.#assertOpen();
    const cursor = validateCursor(cursorInput);
    requireNonEmpty(id, "id");
    if (cursor.workspaceId !== this.workspaceId) return null;
    try {
      const row = this.#db.prepare(`
        SELECT ${EVIDENCE_COLUMNS}
        FROM evidence
        WHERE evidence_id = ?
          AND workspace_id = ?
          AND session_id = ?
          AND leaf_id IS ?
          AND lineage_hash = ?
          AND model_key = ?
      `).get(
        id,
        cursor.workspaceId,
        cursor.sessionId,
        cursor.leafId,
        cursor.lineageHash,
        cursor.modelKey,
      ) as unknown as EvidenceRow | undefined;
      return row ? toEvidenceRecord(row) : null;
    } catch (error) {
      throw mapSqliteError(error, "get-evidence");
    }
  }

  getSchemaVersion(): number {
    this.#assertOpen();
    const row = this.#db.prepare("SELECT MAX(version) AS version FROM schema_migration").get() as {
      version: number | null;
    };
    return row.version ?? 0;
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    try {
      this.#db.close();
    } finally {
      OPEN_PATHS.delete(this.path);
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new StorageNodeError("PCR_SQLITE_CLOSED");
  }
}

export async function openWorkspaceSqliteStore(
  input: OpenWorkspaceSqliteStoreInput,
): Promise<WorkspaceSqliteEvidenceStore> {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.dataRoot !== "string" || !isAbsolute(input.dataRoot)) failInput("dataRoot");
  if (!WORKSPACE_PATTERN.test(input.workspaceId)) failInput("workspaceId");
  if (!Number.isSafeInteger(input.busyTimeoutMs) || input.busyTimeoutMs < 0 || input.busyTimeoutMs > 5_000) {
    failInput("busyTimeoutMs");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  const workspaceRoot = resolve(input.dataRoot, input.workspaceId);
  const path = join(workspaceRoot, "runtime.sqlite");
  if (OPEN_PATHS.has(path)) {
    throw new StorageNodeError("PCR_SQLITE_WRITER_LOCKED", { workspaceId: input.workspaceId });
  }
  OPEN_PATHS.add(path);
  let db: DatabaseSync | undefined;
  try {
    mkdirSync(workspaceRoot, { recursive: true, mode: 0o700 });
    db = new DatabaseSync(path, { timeout: input.busyTimeoutMs });
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    assertMigrationPlan();
    // DatabaseSync cannot interrupt an in-flight statement; cancellation is admission-only and the lock wait is bounded.
    initializeWorkspace(db, input.workspaceId, Date.now());
    return new WorkspaceSqliteEvidenceStoreImpl(db, path, input.workspaceId);
  } catch (error) {
    try {
      db?.close();
    } catch {
      // Opening failure remains authoritative.
    }
    OPEN_PATHS.delete(path);
    throw mapSqliteError(error, "open-workspace-store");
  }
}
