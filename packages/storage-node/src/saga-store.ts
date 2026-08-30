import { isBlobId, type BlobRef, type RuntimeCursor } from "@pcr/contracts";
import {
  SagaJournalError,
  planSagaRecovery,
  type DurableSagaJournal,
  type HostSnapshot,
  type SagaBlobVerifier,
  type SagaOperation,
  type SagaRecord,
  type SagaState,
} from "@pcr/runtime";

import {
  StorageNodeError,
  type WorkspaceSqliteEvidenceStore,
} from "./sqlite-store.js";
import {
  getWorkspaceSqliteAccess,
  type WorkspaceSqliteAccess,
} from "./internal/sqlite-access.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAGA_STATES = new Set<SagaState>([
  "prepared",
  "runtime_durable",
  "host_visible",
  "acknowledged",
  "committed",
  "stale",
  "failed",
]);

interface SagaRow {
  operation_id: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  kind: string;
  source_content_hash: string;
  host_correlation_id: string;
  raw_blob_id: string;
  config_fingerprint: string;
  state: SagaState;
  host_id: string | null;
  revision: number;
}

const SAGA_COLUMNS = `
  operation_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
  kind, source_content_hash, host_correlation_id, raw_blob_id, config_fingerprint,
  state, host_id, revision
`;

export interface OpenWorkspaceSagaJournalInput {
  database: WorkspaceSqliteEvidenceStore;
  verifyBlob: SagaBlobVerifier["verify"];
}

function failInput(field: string): never {
  throw new SagaJournalError("PCR_SAGA_INPUT_INVALID", { field });
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

function normalizeOperation(value: SagaOperation, workspaceId: string): Readonly<SagaOperation> {
  if (!value || typeof value !== "object") failInput("operation");
  const cursor = snapshotCursor(value.cursor, "operation.cursor");
  const operationId = value.operationId;
  const kind = value.kind;
  const sourceContentHash = value.sourceContentHash;
  const hostCorrelationId = value.hostCorrelationId;
  const rawBlobId = value.rawBlobId;
  const configFingerprint = value.configFingerprint;
  const signal = value.signal;
  requireNonEmpty(operationId, "operation.operationId");
  requireNonEmpty(kind, "operation.kind");
  if (!SHA256_PATTERN.test(sourceContentHash)) failInput("operation.sourceContentHash");
  requireNonEmpty(hostCorrelationId, "operation.hostCorrelationId");
  if (!isBlobId(rawBlobId)) failInput("operation.rawBlobId");
  if (!SHA256_PATTERN.test(configFingerprint)) failInput("operation.configFingerprint");
  if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("operation.signal");
  if (cursor.workspaceId !== workspaceId) {
    throw new SagaJournalError("PCR_SAGA_WORKSPACE_MISMATCH");
  }
  return Object.freeze({
    operationId,
    cursor,
    kind,
    sourceContentHash,
    hostCorrelationId,
    rawBlobId,
    configFingerprint,
    ...(signal === undefined ? {} : { signal }),
  });
}

function normalizeSnapshot(value: HostSnapshot, workspaceId: string): HostSnapshot {
  if (!value || typeof value !== "object" || !Array.isArray(value.entries)) failInput("snapshot");
  const cursor = snapshotCursor(value.cursor, "snapshot.cursor");
  if (cursor.workspaceId !== workspaceId) throw new SagaJournalError("PCR_SAGA_WORKSPACE_MISMATCH");
  const configFingerprint = value.configFingerprint;
  if (!SHA256_PATTERN.test(configFingerprint)) failInput("snapshot.configFingerprint");
  const correlations = new Set<string>();
  const hostIds = new Set<string>();
  const entries = value.entries.map((entry, index) => {
    if (!entry || typeof entry !== "object") failInput(`snapshot.entries[${index}]`);
    const hostId = entry.hostId;
    const hostCorrelationId = entry.hostCorrelationId;
    const contentHash = entry.contentHash;
    requireNonEmpty(hostId, `snapshot.entries[${index}].hostId`);
    requireNonEmpty(hostCorrelationId, `snapshot.entries[${index}].hostCorrelationId`);
    if (!SHA256_PATTERN.test(contentHash)) failInput(`snapshot.entries[${index}].contentHash`);
    if (correlations.has(hostCorrelationId)) failInput("snapshot.entries.hostCorrelationId.duplicate");
    if (hostIds.has(hostId)) failInput("snapshot.entries.hostId.duplicate");
    correlations.add(hostCorrelationId);
    hostIds.add(hostId);
    return Object.freeze({
      hostId,
      hostCorrelationId,
      contentHash,
    });
  });
  return Object.freeze({ cursor, configFingerprint, entries: Object.freeze(entries) });
}

function toRecord(row: SagaRow): SagaRecord {
  const cursor = snapshotCursor({
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    leafId: row.leaf_id,
    lineageHash: row.lineage_hash,
    modelKey: row.model_key,
  }, "row.cursor");
  if (
    !isBlobId(row.raw_blob_id)
    || !SHA256_PATTERN.test(row.source_content_hash)
    || !SHA256_PATTERN.test(row.config_fingerprint)
    || !SAGA_STATES.has(row.state)
    || !Number.isSafeInteger(row.revision)
    || row.revision < 1
  ) {
    throw new SagaJournalError("PCR_SAGA_STORAGE_FAILURE", { field: "saga-row" });
  }
  requireNonEmpty(row.operation_id, "row.operationId");
  requireNonEmpty(row.kind, "row.kind");
  requireNonEmpty(row.host_correlation_id, "row.hostCorrelationId");
  if (row.host_id !== null) requireNonEmpty(row.host_id, "row.hostId");
  return {
    operationId: row.operation_id,
    cursor,
    kind: row.kind,
    sourceContentHash: row.source_content_hash,
    hostCorrelationId: row.host_correlation_id,
    rawBlobId: row.raw_blob_id,
    configFingerprint: row.config_fingerprint,
    state: row.state,
    ...(row.host_id === null ? {} : { hostId: row.host_id }),
    revision: row.revision,
  };
}

function sameOperation(record: SagaRecord, operation: Readonly<SagaOperation>): boolean {
  return record.operationId === operation.operationId
    && record.cursor.workspaceId === operation.cursor.workspaceId
    && record.cursor.sessionId === operation.cursor.sessionId
    && record.cursor.leafId === operation.cursor.leafId
    && record.cursor.lineageHash === operation.cursor.lineageHash
    && record.cursor.modelKey === operation.cursor.modelKey
    && record.kind === operation.kind
    && record.sourceContentHash === operation.sourceContentHash
    && record.hostCorrelationId === operation.hostCorrelationId
    && record.rawBlobId === operation.rawBlobId
    && record.configFingerprint === operation.configFingerprint;
}

function sameIntent(record: SagaRecord, operation: Readonly<SagaOperation>): boolean {
  return sameOperation({ ...record, operationId: operation.operationId }, operation);
}

function mapStorageError(error: unknown): SagaJournalError {
  if (error instanceof SagaJournalError) return error;
  if (error instanceof StorageNodeError) {
    if (error.code === "PCR_SQLITE_BUSY" || error.code === "PCR_SQLITE_WRITER_LOCKED") {
      return new SagaJournalError("PCR_SAGA_STORAGE_BUSY", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_CLOSED") {
      return new SagaJournalError("PCR_SAGA_CLOSED", {}, { cause: error });
    }
  }
  return new SagaJournalError("PCR_SAGA_STORAGE_FAILURE", {}, { cause: error });
}

class WorkspaceSagaJournal implements DurableSagaJournal {
  readonly #database: WorkspaceSqliteAccess;
  readonly #workspaceId: string;
  readonly #verifyBlob: SagaBlobVerifier["verify"];
  #closed = false;

  constructor(database: WorkspaceSqliteAccess, verifyBlob: SagaBlobVerifier["verify"]) {
    this.#database = database;
    this.#workspaceId = database.workspaceId;
    this.#verifyBlob = verifyBlob;
  }

  async prepare(input: SagaOperation): Promise<SagaRecord> {
    this.#assertOpen();
    const operation = normalizeOperation(input, this.#workspaceId);
    operation.signal?.throwIfAborted();
    const current = await this.get(operation.operationId);
    if (current) {
      operation.signal?.throwIfAborted();
      if (!sameOperation(current, operation)) throw new SagaJournalError("PCR_SAGA_OPERATION_CONFLICT");
      return current;
    }
    const correlated = this.#getByScopedCorrelation(operation);
    operation.signal?.throwIfAborted();
    if (correlated) {
      if (!sameIntent(correlated, operation)) {
        throw new SagaJournalError("PCR_SAGA_CORRELATION_CONFLICT");
      }
      return correlated;
    }
    await this.#verifyBlob(operation.cursor, operation.rawBlobId);
    operation.signal?.throwIfAborted();
    this.#assertOpen();
    try {
      const outcome = this.#database.transaction("prepare-saga", (db) => {
        const existing = db.prepare(`SELECT ${SAGA_COLUMNS} FROM saga_journal WHERE operation_id = ?`).get(
          operation.operationId,
        ) as unknown as SagaRow | undefined;
        if (existing) return { kind: "existing" as const, record: toRecord(existing) };
        const correlation = db.prepare(`
          SELECT ${SAGA_COLUMNS} FROM saga_journal
          WHERE workspace_id = ?
            AND session_id = ?
            AND leaf_id IS ?
            AND lineage_hash = ?
            AND model_key = ?
            AND config_fingerprint = ?
            AND host_correlation_id = ?
        `).get(
          this.#workspaceId,
          operation.cursor.sessionId,
          operation.cursor.leafId,
          operation.cursor.lineageHash,
          operation.cursor.modelKey,
          operation.configFingerprint,
          operation.hostCorrelationId,
        ) as unknown as SagaRow | undefined;
        if (correlation) return { kind: "correlation-existing" as const, record: toRecord(correlation) };
        db.prepare(`
          INSERT INTO saga_journal (${SAGA_COLUMNS})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'runtime_durable', NULL, 1)
        `).run(
          operation.operationId,
          operation.cursor.workspaceId,
          operation.cursor.sessionId,
          operation.cursor.leafId,
          operation.cursor.lineageHash,
          operation.cursor.modelKey,
          operation.kind,
          operation.sourceContentHash,
          operation.hostCorrelationId,
          operation.rawBlobId,
          operation.configFingerprint,
        );
        const inserted = db.prepare(`SELECT ${SAGA_COLUMNS} FROM saga_journal WHERE operation_id = ?`).get(
          operation.operationId,
        ) as unknown as SagaRow;
        return { kind: "inserted" as const, record: toRecord(inserted) };
      });
      if (outcome.kind === "correlation-existing") {
        if (!sameIntent(outcome.record, operation)) {
          throw new SagaJournalError("PCR_SAGA_CORRELATION_CONFLICT");
        }
        return outcome.record;
      }
      if (outcome.kind === "existing" && !sameOperation(outcome.record, operation)) {
        throw new SagaJournalError("PCR_SAGA_OPERATION_CONFLICT");
      }
      return outcome.record;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async markHostVisible(operationId: string, hostId: string): Promise<void> {
    this.#assertOpen();
    requireNonEmpty(operationId, "operationId");
    requireNonEmpty(hostId, "hostId");
    try {
      const outcome = this.#database.transaction("mark-saga-host-visible", (db) => {
        const row = db.prepare(`SELECT ${SAGA_COLUMNS} FROM saga_journal WHERE operation_id = ?`).get(
          operationId,
        ) as unknown as SagaRow | undefined;
        if (!row) return "missing" as const;
        const record = toRecord(row);
        if (record.hostId !== undefined && record.hostId !== hostId) return "host-conflict" as const;
        const hostOwner = db.prepare(`
          SELECT operation_id FROM saga_journal
          WHERE workspace_id = ?
            AND session_id = ?
            AND leaf_id IS ?
            AND lineage_hash = ?
            AND model_key = ?
            AND config_fingerprint = ?
            AND host_id = ?
        `).get(
          record.cursor.workspaceId,
          record.cursor.sessionId,
          record.cursor.leafId,
          record.cursor.lineageHash,
          record.cursor.modelKey,
          record.configFingerprint,
          hostId,
        ) as { operation_id: string } | undefined;
        if (hostOwner && hostOwner.operation_id !== operationId) return "host-conflict" as const;
        if (
          record.state === "host_visible"
          || record.state === "acknowledged"
          || record.state === "committed"
        ) return "idempotent" as const;
        if (record.state !== "runtime_durable") return "terminal" as const;
        db.prepare(`
          UPDATE saga_journal
          SET state = 'host_visible', host_id = ?, revision = revision + 1
          WHERE operation_id = ?
        `).run(hostId, operationId);
        return "updated" as const;
      });
      if (outcome === "missing") throw new SagaJournalError("PCR_SAGA_NOT_FOUND");
      if (outcome === "host-conflict") throw new SagaJournalError("PCR_SAGA_HOST_CONFLICT");
      if (outcome === "terminal") throw new SagaJournalError("PCR_SAGA_INVALID_TRANSITION");
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async reconcile(snapshotInput: HostSnapshot) {
    this.#assertOpen();
    const snapshot = normalizeSnapshot(snapshotInput, this.#workspaceId);
    try {
      const outcome = this.#database.transaction("reconcile-saga", (db) => {
        const rows = db.prepare(`
          SELECT ${SAGA_COLUMNS}
          FROM saga_journal
          WHERE workspace_id = ? AND session_id = ?
          ORDER BY operation_id
        `).all(this.#workspaceId, snapshot.cursor.sessionId) as unknown as SagaRow[];
        const records = rows.map(toRecord);
        const byOperationId = new Map(records.map((record) => [record.operationId, record]));
        const plan = planSagaRecovery(records, snapshot);
        for (const transition of plan.transitions) {
          const record = byOperationId.get(transition.operationId);
          if (!record) return { kind: "invalid-plan" as const };
          if (transition.hostId !== undefined && record.hostId === undefined) {
            const hostOwner = db.prepare(`
              SELECT operation_id FROM saga_journal
              WHERE workspace_id = ?
                AND session_id = ?
                AND leaf_id IS ?
                AND lineage_hash = ?
                AND model_key = ?
                AND config_fingerprint = ?
                AND host_id = ?
            `).get(
              record.cursor.workspaceId,
              record.cursor.sessionId,
              record.cursor.leafId,
              record.cursor.lineageHash,
              record.cursor.modelKey,
              record.configFingerprint,
              transition.hostId,
            ) as { operation_id: string } | undefined;
            if (hostOwner && hostOwner.operation_id !== transition.operationId) {
              return { kind: "host-conflict" as const };
            }
          }
        }
        for (const transition of plan.transitions) {
          if (transition.state === "committed") {
            db.prepare(`
              UPDATE saga_journal
              SET state = 'acknowledged', host_id = COALESCE(host_id, ?), revision = revision + 1
              WHERE operation_id = ? AND state NOT IN ('committed', 'stale', 'failed')
            `).run(transition.hostId ?? null, transition.operationId);
            db.prepare(`
              UPDATE saga_journal
              SET state = 'committed', revision = revision + 1
              WHERE operation_id = ? AND state = 'acknowledged'
            `).run(transition.operationId);
          } else {
            db.prepare(`
              UPDATE saga_journal
              SET state = ?, host_id = COALESCE(host_id, ?), revision = revision + 1
              WHERE operation_id = ? AND state NOT IN ('committed', 'stale', 'failed')
            `).run(transition.state, transition.hostId ?? null, transition.operationId);
          }
        }
        return { kind: "report" as const, report: { actions: plan.actions } };
      });
      if (outcome.kind === "host-conflict") throw new SagaJournalError("PCR_SAGA_HOST_CONFLICT");
      if (outcome.kind === "invalid-plan") throw new SagaJournalError("PCR_SAGA_STORAGE_FAILURE");
      return outcome.report;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async get(operationId: string): Promise<SagaRecord | null> {
    this.#assertOpen();
    requireNonEmpty(operationId, "operationId");
    try {
      return this.#database.read("get-saga", (db) => {
        const row = db.prepare(`
          SELECT ${SAGA_COLUMNS} FROM saga_journal
          WHERE operation_id = ? AND workspace_id = ?
        `).get(operationId, this.#workspaceId) as unknown as SagaRow | undefined;
        return row ? toRecord(row) : null;
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  #getByScopedCorrelation(operation: Readonly<SagaOperation>): SagaRecord | null {
    try {
      return this.#database.read("get-saga-by-correlation", (db) => {
        const row = db.prepare(`
          SELECT ${SAGA_COLUMNS} FROM saga_journal
          WHERE workspace_id = ?
            AND session_id = ?
            AND leaf_id IS ?
            AND lineage_hash = ?
            AND model_key = ?
            AND config_fingerprint = ?
            AND host_correlation_id = ?
        `).get(
          this.#workspaceId,
          operation.cursor.sessionId,
          operation.cursor.leafId,
          operation.cursor.lineageHash,
          operation.cursor.modelKey,
          operation.configFingerprint,
          operation.hostCorrelationId,
        ) as unknown as SagaRow | undefined;
        return row ? toRecord(row) : null;
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new SagaJournalError("PCR_SAGA_CLOSED");
  }
}

export async function openWorkspaceSagaJournal(
  input: OpenWorkspaceSagaJournalInput,
): Promise<DurableSagaJournal> {
  if (!input || typeof input !== "object") failInput("input");
  if (!input.database || typeof input.database !== "object") {
    throw new SagaJournalError("PCR_SAGA_DEPENDENCY_MISSING", { dependency: "database" });
  }
  if (typeof input.verifyBlob !== "function") {
    throw new SagaJournalError("PCR_SAGA_DEPENDENCY_MISSING", { dependency: "verifyBlob" });
  }
  let access: WorkspaceSqliteAccess;
  try {
    const ownedAccess = getWorkspaceSqliteAccess(input.database);
    if (!ownedAccess) {
      throw new SagaJournalError("PCR_SAGA_DEPENDENCY_MISSING", { dependency: "database" });
    }
    access = ownedAccess;
    access.read("open-saga", () => undefined);
  } catch (error) {
    if (error instanceof StorageNodeError && error.code === "PCR_SQLITE_INPUT_INVALID") {
      throw new SagaJournalError("PCR_SAGA_DEPENDENCY_MISSING", { dependency: "database" }, { cause: error });
    }
    throw mapStorageError(error);
  }
  return new WorkspaceSagaJournal(access, input.verifyBlob);
}
