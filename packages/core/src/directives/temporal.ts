import { domainHash, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";

import type { DirectiveCandidate } from "./extract.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface DirectiveResolver {
  apply(candidate: DirectiveCandidate, signal?: AbortSignal): Promise<DirectiveRecord>;
  active(cursor: RuntimeCursor, signal?: AbortSignal): Promise<DirectiveRecord[]>;
}

export type StoredDirectiveRecord = DirectiveRecord & { cursor: RuntimeCursor };

export interface DirectiveRecordStore {
  put(record: StoredDirectiveRecord): Promise<void>;
  list(cursor: RuntimeCursor): Promise<StoredDirectiveRecord[]>;
}

export interface CreateDirectiveResolverInput {
  cursor: RuntimeCursor;
  store: DirectiveRecordStore;
}

export type TemporalDirectiveErrorCode =
  | "PCR_DIRECTIVE_DEPENDENCY_MISSING"
  | "PCR_DIRECTIVE_INPUT_INVALID"
  | "PCR_DIRECTIVE_SCOPE_MISMATCH";

export class TemporalDirectiveError extends TypeError {
  readonly code: TemporalDirectiveErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: TemporalDirectiveErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "TemporalDirectiveError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new TemporalDirectiveError("PCR_DIRECTIVE_INPUT_INVALID", { field });
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

export function parseTemporalAssignment(quote: string): { exactQuote: string; key?: string; value?: string } {
  if (typeof quote !== "string" || quote.length === 0) failInput("quote");
  const exactQuote = quote.replace(/[；;。.\s]+$/u, "").trim();
  if (exactQuote.length === 0) failInput("quote");
  const correction = exactQuote.match(
    /(?:改为|instead(?:\s+of)?|correction:)\s+([A-Za-z_][\w.-]*)\s*[:=]?\s*([^\s；;。]+)/iu,
  );
  if (correction?.[1] && correction[2]) {
    return { exactQuote, key: correction[1].toLowerCase(), value: correction[2].replace(/[，,]+$/u, "") };
  }
  const assigned = exactQuote.match(/\b([A-Za-z_][\w.-]*)\s*[:=]\s*([^\s；;。]+)/u);
  if (assigned?.[1] && assigned[2]) {
    return { exactQuote, key: assigned[1].toLowerCase(), value: assigned[2].replace(/[，,]+$/u, "") };
  }
  return { exactQuote };
}

export function toDirectiveRecord(candidate: DirectiveCandidate): StoredDirectiveRecord {
  if (!candidate || typeof candidate !== "object") failInput("candidate");
  const cursor = snapshotCursor(candidate.cursor, "candidate.cursor");
  requireNonEmpty(candidate.userTurnId, "candidate.userTurnId");
  requireNonEmpty(candidate.exactQuote, "candidate.exactQuote");
  requireNonEmpty(candidate.kind, "candidate.kind");
  requireNonEmpty(candidate.polarity, "candidate.polarity");
  const parsed = parseTemporalAssignment(candidate.exactQuote);
  const directiveId = `dir_${domainHash("directive-record", {
    exactQuote: parsed.exactQuote,
    key: parsed.key ?? null,
    kind: candidate.kind,
    quoteHash: candidate.quoteHash,
    userTurnId: candidate.userTurnId,
    value: parsed.value ?? null,
  })}`;
  return {
    directiveId,
    userTurnId: candidate.userTurnId,
    exactQuote: parsed.exactQuote,
    quoteHash: candidate.quoteHash,
    utf8ByteRange: candidate.utf8ByteRange,
    utf16Range: candidate.utf16Range,
    codePointRange: candidate.codePointRange,
    kind: candidate.kind,
    polarity: candidate.polarity,
    ...(parsed.key === undefined ? {} : { key: parsed.key }),
    ...(parsed.value === undefined ? {} : { value: parsed.value }),
    status: "active",
    cursor,
  };
}

class BoundDirectiveResolver implements DirectiveResolver {
  readonly #cursor: Readonly<RuntimeCursor>;
  readonly #store: DirectiveRecordStore;

  constructor(cursor: Readonly<RuntimeCursor>, store: DirectiveRecordStore) {
    this.#cursor = cursor;
    this.#store = store;
  }

  async apply(candidate: DirectiveCandidate, signal?: AbortSignal): Promise<DirectiveRecord> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
    signal?.throwIfAborted();
    const incoming = toDirectiveRecord(candidate);
    if (!sameCursor(incoming.cursor, this.#cursor)) {
      throw new TemporalDirectiveError("PCR_DIRECTIVE_SCOPE_MISMATCH");
    }
    signal?.throwIfAborted();
    const existing = await this.#store.list(this.#cursor);
    const duplicate = existing.find((row) => row.directiveId === incoming.directiveId);
    if (duplicate) return stripCursor(duplicate);
    if (incoming.key) {
      for (const row of existing) {
        if (row.status !== "active" || row.key !== incoming.key) continue;
        await this.#store.put({ ...row, status: "superseded", supersededBy: incoming.directiveId });
      }
    }
    await this.#store.put(incoming);
    return stripCursor(incoming);
  }

  async active(cursorInput: RuntimeCursor, signal?: AbortSignal): Promise<DirectiveRecord[]> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
    signal?.throwIfAborted();
    const cursor = snapshotCursor(cursorInput, "cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new TemporalDirectiveError("PCR_DIRECTIVE_SCOPE_MISMATCH");
    }
    const rows = await this.#store.list(cursor);
    return rows.filter((row) => row.status === "active").map(stripCursor);
  }
}

function stripCursor(record: StoredDirectiveRecord): DirectiveRecord {
  const { cursor: _cursor, ...rest } = record;
  return rest;
}

export function createDirectiveResolver(input: CreateDirectiveResolverInput): DirectiveResolver {
  if (!input || typeof input !== "object") {
    throw new TemporalDirectiveError("PCR_DIRECTIVE_DEPENDENCY_MISSING", { dependency: "input" });
  }
  if (!input.cursor || typeof input.cursor !== "object") {
    throw new TemporalDirectiveError("PCR_DIRECTIVE_DEPENDENCY_MISSING", { dependency: "cursor" });
  }
  if (!input.store || typeof input.store.put !== "function" || typeof input.store.list !== "function") {
    throw new TemporalDirectiveError("PCR_DIRECTIVE_DEPENDENCY_MISSING", { dependency: "store" });
  }
  return new BoundDirectiveResolver(snapshotCursor(input.cursor, "input.cursor"), input.store);
}
