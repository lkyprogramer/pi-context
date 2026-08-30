import { createHash } from "node:crypto";

import {
  domainHash,
  isBlobId,
  sourceAuthorityCeiling,
  type ActionAuthority,
  type CanonicalDirectiveKind,
  type CanonicalDirectivePolarity,
  type RuntimeCursor,
  type SourceClass,
  type TextRange,
  type UserTurnRecord,
} from "@pcr/contracts";

import type { ClauseSpan } from "./segment.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SOURCE_CLASSES = new Set<SourceClass>([
  "system",
  "authenticated-user",
  "untrusted-user",
  "trusted-tool",
  "untrusted-tool",
  "external-content",
  "agent-derived",
]);

export interface DirectiveCandidate {
  userTurnId: string;
  cursor: RuntimeCursor;
  exactQuote: string;
  quoteHash: string;
  utf8ByteRange: TextRange;
  utf16Range: TextRange;
  codePointRange: TextRange;
  kind: CanonicalDirectiveKind;
  polarity: CanonicalDirectivePolarity;
  sourceClass: SourceClass;
  authority: ActionAuthority;
  clauseIndex: number;
}

export interface CreateDirectiveExtractorInput {
  cursor: RuntimeCursor;
}

export interface DirectiveExtractor {
  extract(turn: UserTurnRecord, clauses: ClauseSpan[], signal?: AbortSignal): DirectiveCandidate[];
}

export type DirectiveExtractorErrorCode =
  | "PCR_DIRECTIVE_DEPENDENCY_MISSING"
  | "PCR_DIRECTIVE_INPUT_INVALID"
  | "PCR_DIRECTIVE_SCOPE_MISMATCH";

export class DirectiveExtractorError extends TypeError {
  readonly code: DirectiveExtractorErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DirectiveExtractorErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "DirectiveExtractorError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new DirectiveExtractorError("PCR_DIRECTIVE_INPUT_INVALID", { field });
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

function classify(text: string): { kind: CanonicalDirectiveKind; polarity: CanonicalDirectivePolarity } | null {
  if (/不要|(?:\bdo not\b|\bdon't\b|\bnever\b)/iu.test(text)) {
    return { kind: "prohibition", polarity: "must-not" };
  }
  if (/改为|\binstead\b|correction:/iu.test(text)) {
    return { kind: "correction", polarity: "must" };
  }
  if (/至少|必须|\bmust\b/iu.test(text)) {
    return { kind: "constraint", polarity: "must" };
  }
  if (/(?:src|lib|app|packages)\/[\w./-]+\.\w+/u.test(text)) {
    return { kind: "constraint", polarity: "is" };
  }
  if (/可以|\bmay\b|\ballow/iu.test(text)) {
    return { kind: "permission", polarity: "may" };
  }
  return null;
}

function requireRange(range: TextRange | undefined, field: string): TextRange {
  if (
    !range
    || typeof range !== "object"
    || !Number.isSafeInteger(range.start)
    || !Number.isSafeInteger(range.end)
    || range.start < 0
    || range.end < range.start
  ) {
    failInput(field);
  }
  return { start: range.start, end: range.end };
}

export function extractDirectiveCandidates(
  turn: UserTurnRecord,
  clauses: ClauseSpan[],
  signal?: AbortSignal,
): DirectiveCandidate[] {
  if (!turn || typeof turn !== "object") failInput("turn");
  const cursor = snapshotCursor(turn.cursor, "turn.cursor");
  requireNonEmpty(turn.userTurnId, "turn.userTurnId");
  if (!SHA256_PATTERN.test(turn.rawTextHash)) failInput("turn.rawTextHash");
  if (!isBlobId(turn.rawBlobId)) failInput("turn.rawBlobId");
  if (!Number.isSafeInteger(turn.utf8Bytes) || turn.utf8Bytes < 0) failInput("turn.utf8Bytes");
  if (!SOURCE_CLASSES.has(turn.sourceClass)) failInput("turn.sourceClass");
  if (!Number.isSafeInteger(turn.capturedAt) || turn.capturedAt < 0) failInput("turn.capturedAt");
  if (!Array.isArray(clauses)) failInput("clauses");
  if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
  signal?.throwIfAborted();
  const reconstructed = clauses.map((clause, index) => {
    if (!clause || typeof clause !== "object") failInput(`clauses[${index}]`);
    if (typeof clause.text !== "string") failInput(`clauses[${index}].text`);
    requireRange(clause.utf8ByteRange, `clauses[${index}].utf8ByteRange`);
    requireRange(clause.utf16Range, `clauses[${index}].utf16Range`);
    requireRange(clause.codePointRange, `clauses[${index}].codePointRange`);
    return clause.text;
  }).join("");
  const reconstructedHash = createHash("sha256").update(Buffer.from(reconstructed, "utf8")).digest("hex");
  if (reconstructedHash !== turn.rawTextHash || Buffer.byteLength(reconstructed, "utf8") !== turn.utf8Bytes) {
    failInput("clauses.source");
  }
  const authority = sourceAuthorityCeiling(turn.sourceClass);
  const candidates: DirectiveCandidate[] = [];
  for (const [clauseIndex, clause] of clauses.entries()) {
    signal?.throwIfAborted();
    const classified = classify(clause.text);
    if (!classified) continue;
    candidates.push({
      userTurnId: turn.userTurnId,
      cursor,
      exactQuote: clause.text,
      quoteHash: domainHash("directive-quote", clause.text),
      utf8ByteRange: { start: clause.utf8ByteRange.start, end: clause.utf8ByteRange.end },
      utf16Range: { start: clause.utf16Range.start, end: clause.utf16Range.end },
      codePointRange: { start: clause.codePointRange.start, end: clause.codePointRange.end },
      kind: classified.kind,
      polarity: classified.polarity,
      sourceClass: turn.sourceClass,
      authority,
      clauseIndex,
    });
  }
  return candidates;
}

class BoundDirectiveExtractor implements DirectiveExtractor {
  readonly #cursor: Readonly<RuntimeCursor>;

  constructor(cursor: Readonly<RuntimeCursor>) {
    this.#cursor = cursor;
  }

  extract(turn: UserTurnRecord, clauses: ClauseSpan[], signal?: AbortSignal): DirectiveCandidate[] {
    if (!turn || typeof turn !== "object") failInput("turn");
    const cursor = snapshotCursor(turn.cursor, "turn.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new DirectiveExtractorError("PCR_DIRECTIVE_SCOPE_MISMATCH");
    }
    return extractDirectiveCandidates(turn, clauses, signal);
  }
}

export function createDirectiveExtractor(input: CreateDirectiveExtractorInput): DirectiveExtractor {
  if (!input || typeof input !== "object") {
    throw new DirectiveExtractorError("PCR_DIRECTIVE_DEPENDENCY_MISSING", { dependency: "input" });
  }
  if (!input.cursor || typeof input.cursor !== "object") {
    throw new DirectiveExtractorError("PCR_DIRECTIVE_DEPENDENCY_MISSING", { dependency: "cursor" });
  }
  return new BoundDirectiveExtractor(snapshotCursor(input.cursor, "input.cursor"));
}
