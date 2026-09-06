import { createHash } from "node:crypto";

import {
  domainHash,
  isBlobId,
  type RuntimeCursor,
  type UserTurnRecord,
} from "@pcr/contracts";

import type { BlobStore, UserInputEvent, UserInputReceipt } from "./ports.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_CLASSES = new Set<UserInputEvent["sourceClass"]>([
  "authenticated-user",
  "untrusted-user",
  "agent-derived",
]);

export interface UserTurnLedger {
  prepare(receipt: UserInputReceipt): Promise<UserInputReceipt>;
  abandon(
    cursor: RuntimeCursor,
    receiptId: string,
    reason: "handled",
  ): Promise<UserInputReceipt>;
  link(
    cursor: RuntimeCursor,
    receiptId: string,
    hostMessageId: string,
    userTurnId: string,
  ): Promise<UserTurnRecord>;
}

export interface DurableUserTurnLedger extends UserTurnLedger {
  get(cursor: RuntimeCursor, receiptId: string): Promise<UserInputReceipt | UserTurnRecord | null>;
  close(): Promise<void>;
}

export interface UserTurnService {
  capture(input: UserInputEvent): Promise<UserInputReceipt>;
  abandon(receiptId: string, reason: "handled"): Promise<UserInputReceipt>;
  link(receiptId: string, hostMessageId: string): Promise<UserTurnRecord>;
}

export interface CreateUserTurnServiceInput {
  cursor: RuntimeCursor;
  blobs: BlobStore;
  ledger: UserTurnLedger;
}

export type UserTurnServiceErrorCode =
  | "PCR_USER_TURN_DEPENDENCY_MISSING"
  | "PCR_USER_TURN_INPUT_INVALID"
  | "PCR_USER_TURN_SCOPE_MISMATCH";

export class UserTurnServiceError extends TypeError {
  readonly code: UserTurnServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: UserTurnServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "UserTurnServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new UserTurnServiceError("PCR_USER_TURN_INPUT_INVALID", { field });
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

function sameIdentity(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId;
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return sameIdentity(left, right)
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function rawSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeReceiptResult(
  value: UserInputReceipt,
  expected: Readonly<UserInputReceipt>,
): UserInputReceipt {
  if (
    !value
    || typeof value !== "object"
    || value.receiptId !== expected.receiptId
    || value.operationId !== expected.operationId
    || !sameCursor(value.cursor, expected.cursor)
    || value.rawTextHash !== expected.rawTextHash
    || value.rawBlobId !== expected.rawBlobId
    || value.utf8Bytes !== expected.utf8Bytes
    || value.sourceClass !== expected.sourceClass
    || value.capturedAt !== expected.capturedAt
    || (value.status !== "pending" && value.status !== "handled")
  ) failInput("ledger.prepare.result");
  return Object.freeze({ ...expected, status: value.status, cursor: Object.freeze({ ...expected.cursor }) });
}

class DefaultUserTurnService implements UserTurnService {
  #cursor: Readonly<RuntimeCursor>;
  readonly #blobs: BlobStore;
  readonly #ledger: UserTurnLedger;

  constructor(input: CreateUserTurnServiceInput) {
    if (!input || typeof input !== "object") {
      throw new UserTurnServiceError("PCR_USER_TURN_DEPENDENCY_MISSING", { dependency: "input" });
    }
    if (!input.cursor || typeof input.cursor !== "object") {
      throw new UserTurnServiceError("PCR_USER_TURN_DEPENDENCY_MISSING", { dependency: "cursor" });
    }
    this.#cursor = snapshotCursor(input.cursor, "input.cursor");
    if (!input.blobs || typeof input.blobs.put !== "function" || typeof input.blobs.read !== "function") {
      throw new UserTurnServiceError("PCR_USER_TURN_DEPENDENCY_MISSING", { dependency: "blobs" });
    }
    if (
      !input.ledger
      || typeof input.ledger.prepare !== "function"
      || typeof input.ledger.abandon !== "function"
      || typeof input.ledger.link !== "function"
    ) {
      throw new UserTurnServiceError("PCR_USER_TURN_DEPENDENCY_MISSING", { dependency: "ledger" });
    }
    this.#blobs = input.blobs;
    this.#ledger = input.ledger;
  }

  async capture(value: UserInputEvent): Promise<UserInputReceipt> {
    if (!value || typeof value !== "object") failInput("input");
    const cursor = snapshotCursor(value.cursor, "input.cursor");
    if (!sameIdentity(cursor, this.#cursor)) {
      throw new UserTurnServiceError("PCR_USER_TURN_SCOPE_MISMATCH");
    }
    this.#cursor = cursor;
    requireNonEmpty(value.operationId, "input.operationId");
    if (typeof value.rawText !== "string") failInput("input.rawText");
    if (!SOURCE_CLASSES.has(value.sourceClass)) failInput("input.sourceClass");
    if (!Number.isSafeInteger(value.capturedAt) || value.capturedAt < 0) failInput("input.capturedAt");
    if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) failInput("input.signal");
    const operationId = value.operationId;
    const rawText = value.rawText;
    const sourceClass = value.sourceClass;
    const capturedAt = value.capturedAt;
    const signal = value.signal;
    const bytes = Buffer.from(rawText, "utf8");
    const rawTextHash = rawSha256(bytes);
    const receiptId = `receipt_${domainHash("user-input-receipt", {
      capturedAt,
      cursor,
      operationId,
      rawTextHash,
      sourceClass,
    })}`;
    signal?.throwIfAborted();
    const rawBlobId = await this.#blobs.put(cursor, bytes);
    signal?.throwIfAborted();
    if (!isBlobId(rawBlobId)) failInput("blobs.put.rawBlobId");
    const receipt = Object.freeze({
      receiptId,
      operationId,
      cursor,
      rawTextHash,
      rawBlobId,
      utf8Bytes: bytes.byteLength,
      sourceClass,
      capturedAt,
      status: "pending" as const,
    });
    return normalizeReceiptResult(await this.#ledger.prepare(receipt), receipt);
  }

  async abandon(receiptId: string, reason: "handled"): Promise<UserInputReceipt> {
    requireNonEmpty(receiptId, "receiptId");
    if (reason !== "handled") failInput("reason");
    const receipt = await this.#ledger.abandon(this.#cursor, receiptId, reason);
    if (receipt.status !== "handled") failInput("ledger.abandon.result");
    return Object.freeze({ ...receipt, cursor: Object.freeze({ ...receipt.cursor }) });
  }

  async link(receiptId: string, hostMessageId: string): Promise<UserTurnRecord> {
    requireNonEmpty(receiptId, "receiptId");
    requireNonEmpty(hostMessageId, "hostMessageId");
    const userTurnId = `user_turn_${domainHash("user-turn", {
      cursor: this.#cursor,
      hostMessageId,
      receiptId,
    })}`;
    const record = await this.#ledger.link(this.#cursor, receiptId, hostMessageId, userTurnId);
    if (
      !record
      || record.hostMessageId !== hostMessageId
      || !sameIdentity(record.cursor, this.#cursor)
      || !SHA256_PATTERN.test(record.rawTextHash)
      || !isBlobId(record.rawBlobId)
    ) {
      failInput("ledger.link.result");
    }
    return Object.freeze({ ...record, cursor: Object.freeze({ ...record.cursor }) });
  }
}

export function createUserTurnService(input: CreateUserTurnServiceInput): UserTurnService {
  return new DefaultUserTurnService(input);
}
