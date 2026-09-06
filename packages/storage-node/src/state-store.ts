import type { ActionAuthority, DirectiveRecord, RuntimeCursor } from "@pcr/contracts";
import type { DatabaseSync } from "node:sqlite";

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
const UNBOUND = new Set(["unbound", ""]);
const DIRECTIVE_KINDS = new Set(["goal", "constraint", "prohibition", "correction", "permission", "format"]);
const DIRECTIVE_POLARITIES = new Set(["must", "must-not", "may", "is", "is-not", "unknown"]);
const DIRECTIVE_STATUSES = new Set(["active", "superseded", "resolved", "retracted", "contested"]);
const CLAIM_AUTHORITIES = new Set<ActionAuthority>(["none", "inform", "propose", "act"]);

export interface StoredDirectiveRecord extends DirectiveRecord {
  cursor: RuntimeCursor;
}

export interface PersistentClaimRecord {
  claimId: string;
  cursor: RuntimeCursor;
  key: string;
  polarity: string;
  status: string;
  value: unknown;
  authority: ActionAuthority;
}

export interface PersistentContinuityRevision {
  revisionId: string;
  parentRevisionId: string | null;
  contentHash: string;
  cursor: RuntimeCursor;
  taskFronts: {
    active: unknown[];
    parked: unknown[];
    completed: unknown[];
    superseded: unknown[];
  };
  nextSafeActions: Array<{ text: string; requires: string[] }>;
}

export interface PersistentCacheReceipt {
  viewId: string;
  cursor: RuntimeCursor;
  sections: Array<{ kind: string; zone: string; contentHash: string; tokenCost: number }>;
  firstDifferentSection: string | null;
  eligiblePrefixTokens: number;
  previousViewId: string | null;
}

export interface RuntimeSnapshotRows {
  cursor: RuntimeCursor;
  directives: StoredDirectiveRecord[];
  claims: PersistentClaimRecord[];
  continuity: PersistentContinuityRevision | null;
  pointers: Array<{ ref: string; kind: string }>;
  sourceEntryIds: string[];
  schemaVersion: number;
}

export interface WorkspaceStateStore {
  putDirective(record: StoredDirectiveRecord): Promise<void>;
  listDirectives(cursor: RuntimeCursor): Promise<StoredDirectiveRecord[]>;
  putClaim(record: PersistentClaimRecord): Promise<void>;
  listClaims(cursor: RuntimeCursor): Promise<PersistentClaimRecord[]>;
  putDirectiveProjection(
    cursor: RuntimeCursor,
    directives: StoredDirectiveRecord[],
    claims: PersistentClaimRecord[],
  ): Promise<void>;
  putContinuity(revision: PersistentContinuityRevision): Promise<void>;
  headContinuity(cursor: RuntimeCursor): Promise<PersistentContinuityRevision | null>;
  putCacheReceipt(receipt: PersistentCacheReceipt): Promise<void>;
  headCacheReceipt(cursor: RuntimeCursor): Promise<PersistentCacheReceipt | null>;
  readSnapshot(cursor: RuntimeCursor): Promise<RuntimeSnapshotRows>;
}

export type StateStoreErrorCode =
  | "PCR_STATE_STORE_CLOSED"
  | "PCR_STATE_STORE_DEPENDENCY_MISSING"
  | "PCR_STATE_STORE_INPUT_INVALID"
  | "PCR_STATE_STORE_SCOPE_MISMATCH"
  | "PCR_STATE_STORE_STORAGE_BUSY"
  | "PCR_STATE_STORE_STORAGE_FAILURE"
  | "PCR_STATE_STORE_UNBOUND";

export class StateStoreError extends Error {
  readonly code: StateStoreErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: StateStoreErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "StateStoreError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface OpenWorkspaceStateStoreInput {
  database: WorkspaceSqliteEvidenceStore;
}

function failMissing(dependency: string): never {
  throw new StateStoreError("PCR_STATE_STORE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new StateStoreError("PCR_STATE_STORE_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): RuntimeCursor {
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
  if (UNBOUND.has(cursor.sessionId) || UNBOUND.has(cursor.modelKey)) {
    throw new StateStoreError("PCR_STATE_STORE_UNBOUND", { field: `${field}.sessionId` });
  }
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return cursor;
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function requireTextRange(value: unknown, field: string): void {
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger((value as { start?: unknown }).start)
    || !Number.isSafeInteger((value as { end?: unknown }).end)
    || (value as { start: number }).start < 0
    || (value as { end: number }).end < (value as { start: number }).start
  ) {
    failInput(field);
  }
}

function requireOptionalNonEmpty(value: unknown, field: string): void {
  if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
    failInput(field);
  }
}

interface PreparedDirectiveRecord {
  record: StoredDirectiveRecord;
  cursor: RuntimeCursor;
}

interface PreparedClaimRecord {
  record: PersistentClaimRecord;
  cursor: RuntimeCursor;
  valueJson: string;
}

function scopeParams(cursor: RuntimeCursor) {
  return [cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey] as const;
}

function mapStorageError(error: unknown): StateStoreError {
  if (error instanceof StateStoreError) return error;
  if (error instanceof StorageNodeError) {
    if (error.cause instanceof StateStoreError) return error.cause;
    if (error.code === "PCR_SQLITE_BUSY" || error.code === "PCR_SQLITE_WRITER_LOCKED") {
      return new StateStoreError("PCR_STATE_STORE_STORAGE_BUSY", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_CLOSED") {
      return new StateStoreError("PCR_STATE_STORE_CLOSED", {}, { cause: error });
    }
  }
  return new StateStoreError("PCR_STATE_STORE_STORAGE_FAILURE", {}, { cause: error });
}

function prepareDirectiveRecord(record: unknown, field: string): PreparedDirectiveRecord {
  if (!record || typeof record !== "object") failInput(field);
  const value = record as StoredDirectiveRecord;
  const cursor = snapshotCursor(value.cursor, `${field}.cursor`);
  requireNonEmpty(value.directiveId, `${field}.directiveId`);
  requireNonEmpty(value.userTurnId, `${field}.userTurnId`);
  requireNonEmpty(value.exactQuote, `${field}.exactQuote`);
  if (!SHA256_PATTERN.test(value.quoteHash)) failInput(`${field}.quoteHash`);
  requireTextRange(value.utf8ByteRange, `${field}.utf8ByteRange`);
  requireTextRange(value.utf16Range, `${field}.utf16Range`);
  requireTextRange(value.codePointRange, `${field}.codePointRange`);
  if (!DIRECTIVE_KINDS.has(value.kind)) failInput(`${field}.kind`);
  if (!DIRECTIVE_POLARITIES.has(value.polarity)) failInput(`${field}.polarity`);
  if (!DIRECTIVE_STATUSES.has(value.status)) failInput(`${field}.status`);
  requireOptionalNonEmpty(value.key, `${field}.key`);
  requireOptionalNonEmpty(value.value, `${field}.value`);
  requireOptionalNonEmpty(value.supersededBy, `${field}.supersededBy`);
  return { record: value, cursor };
}

function prepareClaimRecord(record: unknown, field: string): PreparedClaimRecord {
  if (!record || typeof record !== "object") failInput(field);
  const value = record as PersistentClaimRecord;
  const cursor = snapshotCursor(value.cursor, `${field}.cursor`);
  requireNonEmpty(value.claimId, `${field}.claimId`);
  requireNonEmpty(value.key, `${field}.key`);
  requireNonEmpty(value.polarity, `${field}.polarity`);
  requireNonEmpty(value.status, `${field}.status`);
  if (!CLAIM_AUTHORITIES.has(value.authority)) failInput(`${field}.authority`);
  let valueJson: string;
  try {
    valueJson = JSON.stringify(value.value ?? null);
  } catch (error) {
    throw new StateStoreError("PCR_STATE_STORE_INPUT_INVALID", { field: `${field}.value` }, { cause: error });
  }
  if (typeof valueJson !== "string") failInput(`${field}.value`);
  return { record: value, cursor, valueJson };
}

function writeDirective(db: DatabaseSync, prepared: PreparedDirectiveRecord, projectionRecordedAt?: number): void {
  const { record, cursor } = prepared;
  db.prepare(`
    INSERT INTO directive_record (
      directive_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
      user_turn_id, exact_quote, quote_hash, utf8_start, utf8_end, utf16_start, utf16_end,
      code_point_start, code_point_end, kind, polarity, key, value, status, superseded_by, recorded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(directive_id) DO UPDATE SET
      status = excluded.status,
      superseded_by = excluded.superseded_by,
      recorded_at = ${projectionRecordedAt === undefined ? "excluded.recorded_at" : "directive_record.recorded_at"}
  `).run(
    record.directiveId,
    cursor.workspaceId,
    cursor.sessionId,
    cursor.leafId,
    cursor.lineageHash,
    cursor.modelKey,
    record.userTurnId,
    record.exactQuote,
    record.quoteHash,
    record.utf8ByteRange.start,
    record.utf8ByteRange.end,
    record.utf16Range.start,
    record.utf16Range.end,
    record.codePointRange.start,
    record.codePointRange.end,
    record.kind,
    record.polarity,
    record.key ?? null,
    record.value ?? null,
    record.status,
    record.supersededBy ?? null,
    projectionRecordedAt ?? Date.now(),
  );
}

function writeClaim(db: DatabaseSync, prepared: PreparedClaimRecord): void {
  const { record, cursor, valueJson } = prepared;
  if (record.status === "active") {
    db.prepare(`
      UPDATE claim_record
      SET status = 'superseded', revision = revision + 1
      WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
        AND key = ? AND status = 'active' AND claim_id != ?
    `).run(...scopeParams(cursor), record.key, record.claimId);
  }
  const existing = db.prepare("SELECT revision FROM claim_record WHERE claim_id = ?").get(record.claimId) as
    | { revision: number }
    | undefined;
  if (existing) {
    db.prepare(`
      UPDATE claim_record
      SET polarity = ?, status = ?, value_json = ?, authority = ?, revision = revision + 1
      WHERE claim_id = ?
    `).run(record.polarity, record.status, valueJson, record.authority, record.claimId);
    return;
  }
  db.prepare(`
    INSERT INTO claim_record (
      claim_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
      key, polarity, status, value_json, authority, revision
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).run(
    record.claimId,
    cursor.workspaceId,
    cursor.sessionId,
    cursor.leafId,
    cursor.lineageHash,
    cursor.modelKey,
    record.key,
    record.polarity,
    record.status,
    valueJson,
    record.authority,
  );
}

function assertExistingProjectionScope(
  db: DatabaseSync,
  table: "directive_record" | "claim_record",
  idColumn: "directive_id" | "claim_id",
  id: string,
  cursor: RuntimeCursor,
  field: string,
): void {
  const row = db.prepare(
    `SELECT workspace_id, session_id, leaf_id, lineage_hash, model_key FROM ${table} WHERE ${idColumn} = ?`,
  ).get(id) as Record<string, unknown> | undefined;
  if (!row) return;
  const existing = snapshotCursor({
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    leafId: (row.leaf_id as string | null) ?? null,
    lineageHash: String(row.lineage_hash),
    modelKey: String(row.model_key),
  }, field);
  if (!sameCursor(existing, cursor)) {
    throw new StateStoreError("PCR_STATE_STORE_SCOPE_MISMATCH", { field, id });
  }
}

function toDirective(row: Record<string, unknown>): StoredDirectiveRecord {
  const cursor = snapshotCursor({
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    leafId: (row.leaf_id as string | null) ?? null,
    lineageHash: String(row.lineage_hash),
    modelKey: String(row.model_key),
  }, "directive.cursor");
  const record: StoredDirectiveRecord = {
    directiveId: String(row.directive_id),
    userTurnId: String(row.user_turn_id),
    exactQuote: String(row.exact_quote),
    quoteHash: String(row.quote_hash),
    utf8ByteRange: { start: Number(row.utf8_start), end: Number(row.utf8_end) },
    utf16Range: { start: Number(row.utf16_start), end: Number(row.utf16_end) },
    codePointRange: { start: Number(row.code_point_start), end: Number(row.code_point_end) },
    kind: row.kind as StoredDirectiveRecord["kind"],
    polarity: row.polarity as StoredDirectiveRecord["polarity"],
    status: row.status as StoredDirectiveRecord["status"],
    cursor,
  };
  if (typeof row.key === "string") record.key = row.key;
  if (typeof row.value === "string") record.value = row.value;
  if (typeof row.superseded_by === "string") record.supersededBy = row.superseded_by;
  return record;
}

function toClaim(row: Record<string, unknown>): PersistentClaimRecord {
  return {
    claimId: String(row.claim_id),
    cursor: snapshotCursor({
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      leafId: (row.leaf_id as string | null) ?? null,
      lineageHash: String(row.lineage_hash),
      modelKey: String(row.model_key),
    }, "claim.cursor"),
    key: String(row.key),
    polarity: String(row.polarity),
    status: String(row.status),
    value: JSON.parse(String(row.value_json)) as unknown,
    authority: row.authority as ActionAuthority,
  };
}

function toContinuity(row: Record<string, unknown>): PersistentContinuityRevision {
  const cursor = snapshotCursor({
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    leafId: (row.leaf_id as string | null) ?? null,
    lineageHash: String(row.lineage_hash),
    modelKey: String(row.model_key),
  }, "continuity.cursor");
  const fronts = JSON.parse(String(row.task_fronts_json)) as PersistentContinuityRevision["taskFronts"];
  return {
    revisionId: String(row.revision_id),
    parentRevisionId: (row.parent_revision_id as string | null) ?? null,
    contentHash: String(row.content_hash),
    cursor,
    taskFronts: {
      active: [...(fronts.active ?? [])],
      parked: [...(fronts.parked ?? [])],
      completed: [...(fronts.completed ?? [])],
      superseded: [...(fronts.superseded ?? [])],
    },
    nextSafeActions: JSON.parse(String(row.next_safe_actions_json)) as PersistentContinuityRevision["nextSafeActions"],
  };
}

function toCache(row: Record<string, unknown>): PersistentCacheReceipt {
  return {
    viewId: String(row.view_id),
    cursor: snapshotCursor({
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      leafId: (row.leaf_id as string | null) ?? null,
      lineageHash: String(row.lineage_hash),
      modelKey: String(row.model_key),
    }, "cache.cursor"),
    sections: JSON.parse(String(row.sections_json)) as PersistentCacheReceipt["sections"],
    firstDifferentSection: (row.first_different_section as string | null) ?? null,
    eligiblePrefixTokens: Number(row.eligible_prefix_tokens),
    previousViewId: (row.previous_view_id as string | null) ?? null,
  };
}

const DIRECTIVE_SELECT = `
  SELECT directive_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
         user_turn_id, exact_quote, quote_hash, utf8_start, utf8_end, utf16_start, utf16_end,
         code_point_start, code_point_end, kind, polarity, key, value, status, superseded_by, recorded_at
  FROM directive_record
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY recorded_at, directive_id
`;

const CLAIM_SELECT = `
  SELECT claim_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
         key, polarity, status, value_json, authority, revision
  FROM claim_record
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY key, claim_id
`;

const CONTINUITY_HEAD = `
  SELECT revision_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
         parent_revision_id, content_hash, task_fronts_json, next_safe_actions_json, recorded_at
  FROM continuity_revision
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY recorded_at DESC, revision_id DESC
  LIMIT 1
`;

const CACHE_HEAD = `
  SELECT view_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
         sections_json, first_different_section, eligible_prefix_tokens, previous_view_id, recorded_at
  FROM cache_receipt
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY recorded_at DESC, view_id DESC
  LIMIT 1
`;

const POINTER_SELECT = `
  SELECT raw_blob_id, kind
  FROM evidence
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY observed_at, evidence_id
`;

const SOURCE_SELECT = `
  SELECT operation_id
  FROM user_turn_ledger
  WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
  ORDER BY captured_at, receipt_id
`;

function readSnapshotRows(db: DatabaseSync, cursor: RuntimeCursor, schemaVersion: number): RuntimeSnapshotRows {
  const scope = scopeParams(cursor);
  const directives = (db.prepare(DIRECTIVE_SELECT).all(...scope) as Record<string, unknown>[]).map(toDirective);
  const claims = (db.prepare(CLAIM_SELECT).all(...scope) as Record<string, unknown>[]).map(toClaim);
  const continuityRow = db.prepare(CONTINUITY_HEAD).get(...scope) as Record<string, unknown> | undefined;
  const pointers = (db.prepare(POINTER_SELECT).all(...scope) as Array<{ raw_blob_id: string; kind: string }>).map(
    (row) => ({ ref: row.raw_blob_id, kind: row.kind }),
  );
  const sourceEntryIds = (db.prepare(SOURCE_SELECT).all(...scope) as Array<{ operation_id: string }>).map(
    (row) => row.operation_id,
  );
  return {
    cursor,
    directives,
    claims,
    continuity: continuityRow ? toContinuity(continuityRow) : null,
    pointers,
    sourceEntryIds,
    schemaVersion,
  };
}

class WorkspaceStateStoreImpl implements WorkspaceStateStore {
  readonly #database: WorkspaceSqliteAccess;
  readonly #workspaceId: string;

  constructor(database: WorkspaceSqliteAccess) {
    this.#database = database;
    this.#workspaceId = database.workspaceId;
  }

  #bound(cursor: RuntimeCursor, field: string): RuntimeCursor {
    const scoped = snapshotCursor(cursor, field);
    if (scoped.workspaceId !== this.#workspaceId) {
      throw new StateStoreError("PCR_STATE_STORE_SCOPE_MISMATCH", {
        expectedWorkspaceId: this.#workspaceId,
        actualWorkspaceId: scoped.workspaceId,
      });
    }
    return scoped;
  }

  #prepareDirective(record: unknown, field: string): PreparedDirectiveRecord {
    const prepared = prepareDirectiveRecord(record, field);
    return { ...prepared, cursor: this.#bound(prepared.cursor, `${field}.cursor`) };
  }

  #prepareSingleDirective(record: StoredDirectiveRecord): PreparedDirectiveRecord {
    if (!record || typeof record !== "object") failInput("record");
    const cursor = this.#bound(record.cursor, "record.cursor");
    requireNonEmpty(record.directiveId, "record.directiveId");
    requireNonEmpty(record.userTurnId, "record.userTurnId");
    requireNonEmpty(record.exactQuote, "record.exactQuote");
    if (!SHA256_PATTERN.test(record.quoteHash)) failInput("record.quoteHash");
    return { record, cursor };
  }

  #prepareClaim(record: unknown, field: string): PreparedClaimRecord {
    const prepared = prepareClaimRecord(record, field);
    return { ...prepared, cursor: this.#bound(prepared.cursor, `${field}.cursor`) };
  }

  #prepareSingleClaim(record: PersistentClaimRecord): PreparedClaimRecord {
    if (!record || typeof record !== "object") failInput("record");
    const cursor = this.#bound(record.cursor, "record.cursor");
    requireNonEmpty(record.claimId, "record.claimId");
    requireNonEmpty(record.key, "record.key");
    return { record, cursor, valueJson: JSON.stringify(record.value ?? null) };
  }

  #requireProjectionCursor(recordCursor: RuntimeCursor, cursor: RuntimeCursor, field: string): void {
    if (!sameCursor(recordCursor, cursor)) {
      throw new StateStoreError("PCR_STATE_STORE_SCOPE_MISMATCH", { field });
    }
  }

  async putDirective(record: StoredDirectiveRecord): Promise<void> {
    const prepared = this.#prepareSingleDirective(record);
    try {
      this.#database.transaction("put-directive", (db) => {
        writeDirective(db, prepared);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async listDirectives(cursorInput: RuntimeCursor): Promise<StoredDirectiveRecord[]> {
    const cursor = this.#bound(cursorInput, "cursor");
    try {
      return this.#database.read("list-directives", (db) => {
        return (db.prepare(DIRECTIVE_SELECT).all(...scopeParams(cursor)) as Record<string, unknown>[]).map(toDirective)
          .filter((row) => sameCursor(row.cursor, cursor));
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async putClaim(record: PersistentClaimRecord): Promise<void> {
    const prepared = this.#prepareSingleClaim(record);
    try {
      this.#database.transaction("put-claim", (db) => {
        writeClaim(db, prepared);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async listClaims(cursorInput: RuntimeCursor): Promise<PersistentClaimRecord[]> {
    const cursor = this.#bound(cursorInput, "cursor");
    try {
      return this.#database.read("list-claims", (db) => {
        return (db.prepare(CLAIM_SELECT).all(...scopeParams(cursor)) as Record<string, unknown>[]).map(toClaim)
          .filter((row) => sameCursor(row.cursor, cursor));
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async putDirectiveProjection(
    cursorInput: RuntimeCursor,
    directives: StoredDirectiveRecord[],
    claims: PersistentClaimRecord[],
  ): Promise<void> {
    const cursor = this.#bound(cursorInput, "cursor");
    if (!Array.isArray(directives)) failInput("directives");
    if (!Array.isArray(claims)) failInput("claims");
    const preparedDirectives = directives.map((record, index) => {
      const prepared = this.#prepareDirective(record, `directives[${index}]`);
      this.#requireProjectionCursor(prepared.cursor, cursor, `directives[${index}].cursor`);
      return prepared;
    });
    const preparedClaims = claims.map((record, index) => {
      const prepared = this.#prepareClaim(record, `claims[${index}]`);
      this.#requireProjectionCursor(prepared.cursor, cursor, `claims[${index}].cursor`);
      return prepared;
    });
    try {
      this.#database.transaction("put-directive-projection", (db) => {
        for (const directive of preparedDirectives) {
          assertExistingProjectionScope(
            db,
            "directive_record",
            "directive_id",
            directive.record.directiveId,
            cursor,
            "directive.directiveId",
          );
        }
        for (const claim of preparedClaims) {
          assertExistingProjectionScope(
            db,
            "claim_record",
            "claim_id",
            claim.record.claimId,
            cursor,
            "claim.claimId",
          );
        }
        // Preserve the original ordering on replay; per-row wall-clock sampling
        // can otherwise reorder equal inputs and change checkpoint hashes.
        const recordedAt = Date.now();
        for (const directive of preparedDirectives) writeDirective(db, directive, recordedAt);
        for (const claim of preparedClaims) writeClaim(db, claim);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async putContinuity(revision: PersistentContinuityRevision): Promise<void> {
    if (!revision || typeof revision !== "object") failInput("revision");
    const cursor = this.#bound(revision.cursor, "revision.cursor");
    requireNonEmpty(revision.revisionId, "revision.revisionId");
    if (!SHA256_PATTERN.test(revision.contentHash)) failInput("revision.contentHash");
    try {
      this.#database.transaction("put-continuity", (db) => {
        db.prepare(`
          INSERT INTO continuity_revision (
            revision_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
            parent_revision_id, content_hash, task_fronts_json, next_safe_actions_json, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(revision_id) DO UPDATE SET
            content_hash = excluded.content_hash,
            task_fronts_json = excluded.task_fronts_json,
            next_safe_actions_json = excluded.next_safe_actions_json
        `).run(
          revision.revisionId,
          cursor.workspaceId,
          cursor.sessionId,
          cursor.leafId,
          cursor.lineageHash,
          cursor.modelKey,
          revision.parentRevisionId,
          revision.contentHash,
          JSON.stringify(revision.taskFronts),
          JSON.stringify(revision.nextSafeActions),
          Date.now(),
        );
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async headContinuity(cursorInput: RuntimeCursor): Promise<PersistentContinuityRevision | null> {
    const cursor = this.#bound(cursorInput, "cursor");
    try {
      return this.#database.read("head-continuity", (db) => {
        const row = db.prepare(CONTINUITY_HEAD).get(...scopeParams(cursor)) as Record<string, unknown> | undefined;
        return row ? toContinuity(row) : null;
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async putCacheReceipt(receipt: PersistentCacheReceipt): Promise<void> {
    if (!receipt || typeof receipt !== "object") failInput("receipt");
    const cursor = this.#bound(receipt.cursor, "receipt.cursor");
    requireNonEmpty(receipt.viewId, "receipt.viewId");
    try {
      this.#database.transaction("put-cache-receipt", (db) => {
        db.prepare(`
          INSERT INTO cache_receipt (
            view_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
            sections_json, first_different_section, eligible_prefix_tokens, previous_view_id, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(view_id) DO NOTHING
        `).run(
          receipt.viewId,
          cursor.workspaceId,
          cursor.sessionId,
          cursor.leafId,
          cursor.lineageHash,
          cursor.modelKey,
          JSON.stringify(receipt.sections),
          receipt.firstDifferentSection,
          receipt.eligiblePrefixTokens,
          receipt.previousViewId,
          Date.now(),
        );
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async headCacheReceipt(cursorInput: RuntimeCursor): Promise<PersistentCacheReceipt | null> {
    const cursor = this.#bound(cursorInput, "cursor");
    try {
      return this.#database.read("head-cache-receipt", (db) => {
        const row = db.prepare(CACHE_HEAD).get(...scopeParams(cursor)) as Record<string, unknown> | undefined;
        return row ? toCache(row) : null;
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async readSnapshot(cursorInput: RuntimeCursor): Promise<RuntimeSnapshotRows> {
    const cursor = this.#bound(cursorInput, "cursor");
    try {
      return this.#database.transaction("read-runtime-snapshot", (db) => {
        const schema = db.prepare("SELECT MAX(version) AS version FROM schema_migration").get() as {
          version: number | null;
        };
        return readSnapshotRows(db, cursor, schema.version ?? 0);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }
}

export function openWorkspaceStateStore(input: OpenWorkspaceStateStoreInput): WorkspaceStateStore {
  if (!input || typeof input !== "object" || !input.database || typeof input.database !== "object") {
    failMissing("database");
  }
  const access = getWorkspaceSqliteAccess(input.database);
  if (!access) failMissing("database");
  try {
    access.read("open-state-store", () => undefined);
  } catch (error) {
    throw mapStorageError(error);
  }
  return new WorkspaceStateStoreImpl(access);
}
