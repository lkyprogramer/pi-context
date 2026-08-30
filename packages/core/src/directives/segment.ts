import type { RuntimeCursor, TextRange } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const CLAUSE_BREAK = /[\n；;]/u;

export interface ClauseRange extends TextRange {
  start: number;
  end: number;
}

export interface ClauseSpan {
  text: string;
  utf8ByteRange: ClauseRange;
  utf16Range: ClauseRange;
  codePointRange: ClauseRange;
}

export interface CreateClauseSegmenterInput {
  cursor: RuntimeCursor;
}

export interface SegmentClausesInput {
  text: string;
  cursor?: RuntimeCursor;
  signal?: AbortSignal;
}

export interface ClauseSegmenter {
  segment(input: SegmentClausesInput): ClauseSpan[];
}

export type ClauseSegmenterErrorCode =
  | "PCR_CLAUSE_DEPENDENCY_MISSING"
  | "PCR_CLAUSE_INPUT_INVALID"
  | "PCR_CLAUSE_SCOPE_MISMATCH"
  | "PCR_CLAUSE_UNAVAILABLE";

export class ClauseSegmenterError extends TypeError {
  readonly code: ClauseSegmenterErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: ClauseSegmenterErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "ClauseSegmenterError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new ClauseSegmenterError("PCR_CLAUSE_INPUT_INVALID", { field });
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

function assertWellFormedUtf16(text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (index + 1 >= text.length) failInput("text.utf16");
      const next = text.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) failInput("text.utf16");
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) failInput("text.utf16");
  }
}

function sentenceBounds(text: string): Array<{ start: number; end: number }> {
  if (typeof Intl === "undefined" || typeof Intl.Segmenter !== "function") {
    throw new ClauseSegmenterError("PCR_CLAUSE_UNAVAILABLE", { dependency: "Intl.Segmenter" });
  }
  const segmenter = new Intl.Segmenter("und", { granularity: "sentence" });
  const bounds: Array<{ start: number; end: number }> = [];
  let offset = 0;
  for (const part of segmenter.segment(text)) {
    const start = offset;
    const end = offset + part.segment.length;
    bounds.push(...splitOnClauseBreaks(text, start, end));
    offset = end;
  }
  if (offset !== text.length) failInput("text.coverage");
  return bounds;
}

function splitOnClauseBreaks(text: string, start: number, end: number): Array<{ start: number; end: number }> {
  const slice = text.slice(start, end);
  const parts: Array<{ start: number; end: number }> = [];
  let local = 0;
  for (let index = 0; index < slice.length; index += 1) {
    if (!CLAUSE_BREAK.test(slice[index]!)) continue;
    const cut = index + 1;
    if (cut > local) parts.push({ start: start + local, end: start + cut });
    local = cut;
  }
  if (local < slice.length) parts.push({ start: start + local, end });
  return parts.length > 0 ? parts : [{ start, end }];
}

function spanFor(text: string, start: number, end: number): ClauseSpan {
  const prefix = text.slice(0, start);
  const clause = text.slice(start, end);
  const utf8Start = Buffer.byteLength(prefix, "utf8");
  const utf8End = utf8Start + Buffer.byteLength(clause, "utf8");
  const codePointStart = [...prefix].length;
  const codePointEnd = codePointStart + [...clause].length;
  return {
    text: clause,
    utf8ByteRange: { start: utf8Start, end: utf8End },
    utf16Range: { start, end },
    codePointRange: { start: codePointStart, end: codePointEnd },
  };
}

export function segmentClauses(input: SegmentClausesInput): ClauseSpan[] {
  if (!input || typeof input !== "object") failInput("input");
  if (typeof input.text !== "string") failInput("text");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  assertWellFormedUtf16(input.text);
  if (input.text.length === 0) return [];
  return sentenceBounds(input.text).map((bound) => spanFor(input.text, bound.start, bound.end));
}

class BoundClauseSegmenter implements ClauseSegmenter {
  readonly #cursor: Readonly<RuntimeCursor>;

  constructor(cursor: Readonly<RuntimeCursor>) {
    this.#cursor = cursor;
  }

  segment(input: SegmentClausesInput): ClauseSpan[] {
    if (!input || typeof input !== "object") failInput("input");
    if (input.cursor !== undefined) {
      const cursor = snapshotCursor(input.cursor, "input.cursor");
      if (!sameCursor(cursor, this.#cursor)) {
        throw new ClauseSegmenterError("PCR_CLAUSE_SCOPE_MISMATCH");
      }
    }
    return segmentClauses(input);
  }
}

export function createClauseSegmenter(input: CreateClauseSegmenterInput): ClauseSegmenter {
  if (!input || typeof input !== "object") {
    throw new ClauseSegmenterError("PCR_CLAUSE_DEPENDENCY_MISSING", { dependency: "input" });
  }
  if (!input.cursor || typeof input.cursor !== "object") {
    throw new ClauseSegmenterError("PCR_CLAUSE_DEPENDENCY_MISSING", { dependency: "cursor" });
  }
  return new BoundClauseSegmenter(snapshotCursor(input.cursor, "input.cursor"));
}
