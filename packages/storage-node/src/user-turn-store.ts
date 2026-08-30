import {
  isBlobId,
  type RuntimeCursor,
  type UserTurnRecord,
} from "@pcr/contracts";
import {
  type DurableUserTurnLedger,
  type UserInputReceipt,
} from "@pcr/runtime";

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
const SOURCE_CLASSES = new Set<UserInputReceipt["sourceClass"]>([
  "authenticated-user",
  "untrusted-user",
  "agent-derived",
]);

interface UserTurnRow {
  receipt_id: string;
  operation_id: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  raw_text_hash: string;
  raw_blob_id: string;
  utf8_bytes: number;
  source_class: UserInputReceipt["sourceClass"];
  captured_at: number;
  host_message_id: string | null;
  user_turn_id: string | null;
  revision: number;
  disposition: "pending" | "handled" | "linked";
}

const USER_TURN_COLUMNS = `
  receipt_id, operation_id, workspace_id, session_id, leaf_id, lineage_hash,
  model_key, raw_text_hash, raw_blob_id, utf8_bytes, source_class, captured_at,
  host_message_id, user_turn_id, revision, disposition
`;

export interface OpenWorkspaceUserTurnLedgerInput {
  database: WorkspaceSqliteEvidenceStore;
}

export type UserTurnLedgerErrorCode =
  | "PCR_USER_TURN_LEDGER_CLOSED"
  | "PCR_USER_TURN_LEDGER_CONFLICT"
  | "PCR_USER_TURN_LEDGER_DEPENDENCY_MISSING"
  | "PCR_USER_TURN_LEDGER_HOST_CONFLICT"
  | "PCR_USER_TURN_LEDGER_INPUT_INVALID"
  | "PCR_USER_TURN_LEDGER_NOT_FOUND"
  | "PCR_USER_TURN_LEDGER_STORAGE_BUSY"
  | "PCR_USER_TURN_LEDGER_STORAGE_FAILURE"
  | "PCR_USER_TURN_LEDGER_SCOPE_MISMATCH";

export class UserTurnLedgerError extends Error {
  readonly code: UserTurnLedgerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: UserTurnLedgerErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "UserTurnLedgerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_INPUT_INVALID", { field });
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

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function normalizeReceipt(value: UserInputReceipt, workspaceId: string): Readonly<UserInputReceipt> {
  if (!value || typeof value !== "object") failInput("receipt");
  const cursor = snapshotCursor(value.cursor, "receipt.cursor");
  requireNonEmpty(value.receiptId, "receipt.receiptId");
  requireNonEmpty(value.operationId, "receipt.operationId");
  if (!SHA256_PATTERN.test(value.rawTextHash)) failInput("receipt.rawTextHash");
  if (!isBlobId(value.rawBlobId)) failInput("receipt.rawBlobId");
  if (!Number.isSafeInteger(value.utf8Bytes) || value.utf8Bytes < 0) failInput("receipt.utf8Bytes");
  if (!SOURCE_CLASSES.has(value.sourceClass)) failInput("receipt.sourceClass");
  if (!Number.isSafeInteger(value.capturedAt) || value.capturedAt < 0) failInput("receipt.capturedAt");
  if (value.status !== "pending") failInput("receipt.status");
  if (cursor.workspaceId !== workspaceId) throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_SCOPE_MISMATCH");
  return Object.freeze({
    receiptId: value.receiptId,
    operationId: value.operationId,
    cursor,
    rawTextHash: value.rawTextHash,
    rawBlobId: value.rawBlobId,
    utf8Bytes: value.utf8Bytes,
    sourceClass: value.sourceClass,
    capturedAt: value.capturedAt,
    status: value.status,
  });
}

function validateRow(row: UserTurnRow): void {
  snapshotCursor({
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    leafId: row.leaf_id,
    lineageHash: row.lineage_hash,
    modelKey: row.model_key,
  }, "row.cursor");
  requireNonEmpty(row.receipt_id, "row.receiptId");
  requireNonEmpty(row.operation_id, "row.operationId");
  if (!SHA256_PATTERN.test(row.raw_text_hash)) failInput("row.rawTextHash");
  if (!isBlobId(row.raw_blob_id)) failInput("row.rawBlobId");
  if (!Number.isSafeInteger(row.utf8_bytes) || row.utf8_bytes < 0) failInput("row.utf8Bytes");
  if (!SOURCE_CLASSES.has(row.source_class)) failInput("row.sourceClass");
  if (!Number.isSafeInteger(row.captured_at) || row.captured_at < 0) failInput("row.capturedAt");
  if (!Number.isSafeInteger(row.revision) || row.revision < 1) failInput("row.revision");
  if ((row.host_message_id === null) !== (row.user_turn_id === null)) failInput("row.linkState");
  if (!(["pending", "handled", "linked"] as const).includes(row.disposition)) failInput("row.disposition");
  if (row.disposition === "linked" && row.host_message_id === null) failInput("row.disposition");
  if (row.disposition !== "linked" && row.host_message_id !== null) failInput("row.disposition");
  if (row.host_message_id !== null) requireNonEmpty(row.host_message_id, "row.hostMessageId");
  if (row.user_turn_id !== null) requireNonEmpty(row.user_turn_id, "row.userTurnId");
}

function toReceipt(row: UserTurnRow): UserInputReceipt {
  validateRow(row);
  return Object.freeze({
    receiptId: row.receipt_id,
    operationId: row.operation_id,
    cursor: Object.freeze({
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      leafId: row.leaf_id,
      lineageHash: row.lineage_hash,
      modelKey: row.model_key,
    }),
    rawTextHash: row.raw_text_hash,
    rawBlobId: row.raw_blob_id as UserInputReceipt["rawBlobId"],
    utf8Bytes: row.utf8_bytes,
    sourceClass: row.source_class,
    capturedAt: row.captured_at,
    status: row.disposition === "handled" ? "handled" : "pending",
  });
}

function toRecord(row: UserTurnRow): UserTurnRecord {
  const receipt = toReceipt(row);
  if (row.host_message_id === null || row.user_turn_id === null) {
    throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_STORAGE_FAILURE", { field: "row.linkState" });
  }
  return Object.freeze({
    userTurnId: row.user_turn_id,
    cursor: receipt.cursor,
    rawTextHash: receipt.rawTextHash,
    rawBlobId: receipt.rawBlobId,
    utf8Bytes: receipt.utf8Bytes,
    hostMessageId: row.host_message_id,
    sourceClass: receipt.sourceClass,
    capturedAt: receipt.capturedAt,
  });
}

function sameReceipt(row: UserTurnRow, receipt: Readonly<UserInputReceipt>): boolean {
  return row.receipt_id === receipt.receiptId
    && row.operation_id === receipt.operationId
    && row.workspace_id === receipt.cursor.workspaceId
    && row.session_id === receipt.cursor.sessionId
    && row.leaf_id === receipt.cursor.leafId
    && row.lineage_hash === receipt.cursor.lineageHash
    && row.model_key === receipt.cursor.modelKey
    && row.raw_text_hash === receipt.rawTextHash
    && row.raw_blob_id === receipt.rawBlobId
    && row.utf8_bytes === receipt.utf8Bytes
    && row.source_class === receipt.sourceClass
    && row.captured_at === receipt.capturedAt;
}

function mapStorageError(error: unknown): UserTurnLedgerError {
  if (error instanceof UserTurnLedgerError) return error;
  if (error instanceof StorageNodeError) {
    if (error.code === "PCR_SQLITE_BUSY" || error.code === "PCR_SQLITE_WRITER_LOCKED") {
      return new UserTurnLedgerError("PCR_USER_TURN_LEDGER_STORAGE_BUSY", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_CLOSED") {
      return new UserTurnLedgerError("PCR_USER_TURN_LEDGER_CLOSED", {}, { cause: error });
    }
  }
  return new UserTurnLedgerError("PCR_USER_TURN_LEDGER_STORAGE_FAILURE", {}, { cause: error });
}

class WorkspaceUserTurnLedger implements DurableUserTurnLedger {
  readonly #database: WorkspaceSqliteAccess;
  readonly #workspaceId: string;
  #closed = false;

  constructor(database: WorkspaceSqliteAccess) {
    this.#database = database;
    this.#workspaceId = database.workspaceId;
  }

  async prepare(input: UserInputReceipt): Promise<UserInputReceipt> {
    this.#assertOpen();
    const receipt = normalizeReceipt(input, this.#workspaceId);
    try {
      const outcome = this.#database.transaction("prepare-user-turn", (db) => {
        const existing = db.prepare(`
          SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger
          WHERE receipt_id = ? OR operation_id = ?
          ORDER BY receipt_id = ? DESC
          LIMIT 1
        `).get(receipt.receiptId, receipt.operationId, receipt.receiptId) as unknown as UserTurnRow | undefined;
        if (existing) return { kind: "existing" as const, row: existing };
        db.prepare(`
          INSERT INTO user_turn_ledger (${USER_TURN_COLUMNS})
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, 'pending')
        `).run(
          receipt.receiptId,
          receipt.operationId,
          receipt.cursor.workspaceId,
          receipt.cursor.sessionId,
          receipt.cursor.leafId,
          receipt.cursor.lineageHash,
          receipt.cursor.modelKey,
          receipt.rawTextHash,
          receipt.rawBlobId,
          receipt.utf8Bytes,
          receipt.sourceClass,
          receipt.capturedAt,
        );
        const inserted = db.prepare(`SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?`)
          .get(receipt.receiptId) as unknown as UserTurnRow;
        return { kind: "inserted" as const, row: inserted };
      });
      if (outcome.kind === "existing" && !sameReceipt(outcome.row, receipt)) {
        throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_CONFLICT");
      }
      return toReceipt(outcome.row);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async abandon(
    cursorInput: RuntimeCursor,
    receiptId: string,
    reason: "handled",
  ): Promise<UserInputReceipt> {
    this.#assertOpen();
    const cursor = snapshotCursor(cursorInput);
    if (cursor.workspaceId !== this.#workspaceId) throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_SCOPE_MISMATCH");
    requireNonEmpty(receiptId, "receiptId");
    if (reason !== "handled") failInput("reason");
    try {
      const outcome = this.#database.transaction("abandon-user-turn", (db) => {
        const row = db.prepare(`SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?`)
          .get(receiptId) as unknown as UserTurnRow | undefined;
        if (!row) return { kind: "missing" as const };
        if (!sameCursor(toReceipt(row).cursor, cursor)) return { kind: "scope" as const };
        if (row.disposition === "linked") return { kind: "conflict" as const };
        if (row.disposition === "pending") {
          db.prepare(`
            UPDATE user_turn_ledger
            SET disposition = 'handled', revision = revision + 1
            WHERE receipt_id = ? AND disposition = 'pending'
          `).run(receiptId);
        }
        const handled = db.prepare(`SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?`)
          .get(receiptId) as unknown as UserTurnRow;
        return { kind: "handled" as const, row: handled };
      });
      if (outcome.kind === "missing") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_NOT_FOUND");
      if (outcome.kind === "scope") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_SCOPE_MISMATCH");
      if (outcome.kind === "conflict") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_CONFLICT");
      return toReceipt(outcome.row);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async link(
    cursorInput: RuntimeCursor,
    receiptId: string,
    hostMessageId: string,
    userTurnId: string,
  ): Promise<UserTurnRecord> {
    this.#assertOpen();
    const cursor = snapshotCursor(cursorInput);
    if (cursor.workspaceId !== this.#workspaceId) throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_SCOPE_MISMATCH");
    requireNonEmpty(receiptId, "receiptId");
    requireNonEmpty(hostMessageId, "hostMessageId");
    requireNonEmpty(userTurnId, "userTurnId");
    try {
      const outcome = this.#database.transaction("link-user-turn", (db) => {
        const row = db.prepare(`SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?`)
          .get(receiptId) as unknown as UserTurnRow | undefined;
        if (!row) return { kind: "missing" as const };
        if (!sameCursor(toReceipt(row).cursor, cursor)) return { kind: "scope" as const };
        if (row.disposition === "handled") return { kind: "conflict" as const };
        if (row.host_message_id !== null || row.user_turn_id !== null) {
          return row.host_message_id === hostMessageId && row.user_turn_id === userTurnId
            ? { kind: "linked" as const, row }
            : { kind: "conflict" as const };
        }
        const owner = db.prepare(`
          SELECT receipt_id FROM user_turn_ledger
          WHERE workspace_id = ?
            AND session_id = ?
            AND host_message_id = ?
        `).get(
          cursor.workspaceId,
          cursor.sessionId,
          hostMessageId,
        ) as { receipt_id: string } | undefined;
        if (owner && owner.receipt_id !== receiptId) return { kind: "host-conflict" as const };
        db.prepare(`
          UPDATE user_turn_ledger
          SET host_message_id = ?, user_turn_id = ?, disposition = 'linked', revision = revision + 1
          WHERE receipt_id = ? AND disposition = 'pending' AND host_message_id IS NULL AND user_turn_id IS NULL
        `).run(hostMessageId, userTurnId, receiptId);
        const linked = db.prepare(`SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?`)
          .get(receiptId) as unknown as UserTurnRow;
        return { kind: "linked" as const, row: linked };
      });
      if (outcome.kind === "missing") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_NOT_FOUND");
      if (outcome.kind === "scope") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_SCOPE_MISMATCH");
      if (outcome.kind === "conflict") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_CONFLICT");
      if (outcome.kind === "host-conflict") throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_HOST_CONFLICT");
      return toRecord(outcome.row);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async get(cursorInput: RuntimeCursor, receiptId: string): Promise<UserInputReceipt | UserTurnRecord | null> {
    this.#assertOpen();
    const cursor = snapshotCursor(cursorInput);
    requireNonEmpty(receiptId, "receiptId");
    if (cursor.workspaceId !== this.#workspaceId) return null;
    try {
      const row = this.#database.read("get-user-turn", (db) => db.prepare(`
        SELECT ${USER_TURN_COLUMNS} FROM user_turn_ledger WHERE receipt_id = ?
      `).get(receiptId) as unknown as UserTurnRow | undefined);
      if (!row || !sameCursor(toReceipt(row).cursor, cursor)) return null;
      return row.disposition === "linked" ? toRecord(row) : toReceipt(row);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async close(): Promise<void> {
    this.#closed = true;
  }

  #assertOpen(): void {
    if (this.#closed) throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_CLOSED");
  }
}

export async function openWorkspaceUserTurnLedger(
  input: OpenWorkspaceUserTurnLedgerInput,
): Promise<DurableUserTurnLedger> {
  if (!input || typeof input !== "object" || !input.database || typeof input.database !== "object") {
    throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_DEPENDENCY_MISSING", { dependency: "database" });
  }
  const access = getWorkspaceSqliteAccess(input.database);
  if (!access) {
    throw new UserTurnLedgerError("PCR_USER_TURN_LEDGER_DEPENDENCY_MISSING", { dependency: "database" });
  }
  try {
    access.read("open-user-turn", () => undefined);
  } catch (error) {
    throw mapStorageError(error);
  }
  return new WorkspaceUserTurnLedger(access);
}
