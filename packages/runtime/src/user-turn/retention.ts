import type { RuntimeCursor, UserTurnRecord } from "@pcr/contracts";

import type { BlobStore, UserInputReceipt } from "../ports.js";
import type { DurableUserTurnLedger } from "../user-turn-service.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface RetainedUserTurn {
  receiptId: string;
  userTurnId: string | null;
  rawText: string;
  rawBlobId: UserTurnRecord["rawBlobId"];
  sourceClass: UserInputReceipt["sourceClass"];
}

export interface UserTurnRetention {
  retain(cursor: RuntimeCursor, receipt: UserInputReceipt, signal?: AbortSignal): Promise<RetainedUserTurn>;
  exactRead(cursor: RuntimeCursor, receiptId: string, signal?: AbortSignal): Promise<RetainedUserTurn>;
  list(cursor: RuntimeCursor, signal?: AbortSignal): Promise<RetainedUserTurn[]>;
}

export interface CreateUserTurnRetentionInput {
  cursor: RuntimeCursor;
  ledger: Pick<DurableUserTurnLedger, "get">;
  blobs: BlobStore;
  index?: Map<string, string[]>;
}

export type UserTurnRetentionErrorCode =
  | "PCR_USER_TURN_RETENTION_DEPENDENCY_MISSING"
  | "PCR_USER_TURN_RETENTION_INPUT_INVALID"
  | "PCR_USER_TURN_RETENTION_SCOPE_MISMATCH"
  | "PCR_USER_TURN_RETENTION_NOT_FOUND";

export class UserTurnRetentionError extends TypeError {
  readonly code: UserTurnRetentionErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: UserTurnRetentionErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "UserTurnRetentionError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_INPUT_INVALID", { field });
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
  if (typeof cursor.sessionId !== "string" || cursor.sessionId.length === 0) failInput(`${field}.sessionId`);
  if (cursor.leafId !== null && (typeof cursor.leafId !== "string" || cursor.leafId.length === 0)) failInput(`${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  if (typeof cursor.modelKey !== "string" || cursor.modelKey.length === 0) failInput(`${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function cursorKey(cursor: RuntimeCursor): string {
  return JSON.stringify([cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey]);
}

export function createUserTurnRetention(input: CreateUserTurnRetentionInput): UserTurnRetention {
  if (!input || typeof input !== "object") failMissing("input");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  if (!input.ledger || typeof input.ledger.get !== "function") failMissing("ledger.get");
  if (!input.blobs || typeof input.blobs.read !== "function") failMissing("blobs.read");
  const index = input.index ?? new Map<string, string[]>();

  async function load(cursor: RuntimeCursor, receiptId: string, signal?: AbortSignal): Promise<RetainedUserTurn> {
    signal?.throwIfAborted();
    const row = await input.ledger.get(cursor, receiptId);
    if (!row) throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_NOT_FOUND", { receiptId });
    signal?.throwIfAborted();
    const bytes = await input.blobs.read(cursor, row.rawBlobId);
    const receiptIdValue = "receiptId" in row ? row.receiptId : receiptId;
    const userTurnId = "userTurnId" in row ? row.userTurnId : null;
    return {
      receiptId: receiptIdValue,
      userTurnId,
      rawText: Buffer.from(bytes).toString("utf8"),
      rawBlobId: row.rawBlobId,
      sourceClass: row.sourceClass,
    };
  }

  return {
    async retain(cursorInput, receipt, signal) {
      const cursor = snapshotCursor(cursorInput);
      if (!sameCursor(bound, cursor)) throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_SCOPE_MISMATCH");
      if (!receipt || typeof receipt.receiptId !== "string") failInput("receipt");
      const key = cursorKey(cursor);
      const ids = index.get(key) ?? [];
      if (!ids.includes(receipt.receiptId)) ids.push(receipt.receiptId);
      index.set(key, ids);
      return load(cursor, receipt.receiptId, signal);
    },
    async exactRead(cursorInput, receiptId, signal) {
      const cursor = snapshotCursor(cursorInput);
      if (!sameCursor(bound, cursor)) throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_SCOPE_MISMATCH");
      if (typeof receiptId !== "string" || receiptId.length === 0) failInput("receiptId");
      return load(cursor, receiptId, signal);
    },
    async list(cursorInput, signal) {
      const cursor = snapshotCursor(cursorInput);
      if (!sameCursor(bound, cursor)) throw new UserTurnRetentionError("PCR_USER_TURN_RETENTION_SCOPE_MISMATCH");
      const ids = index.get(cursorKey(cursor)) ?? [];
      const rows: RetainedUserTurn[] = [];
      for (const id of ids) rows.push(await load(cursor, id, signal));
      return rows;
    },
  };
}
