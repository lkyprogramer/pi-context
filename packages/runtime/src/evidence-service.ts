import { createHash } from "node:crypto";

import {
  canonicalJson,
  domainHash,
  isBlobId,
  sourceAuthorityCeiling,
  SOURCE_CLASSES,
  type ActionAuthority,
  type BlobRef,
  type ByteRange,
  type EvidenceRecord,
  type RuntimeCursor,
  type SourceClass,
} from "@pcr/contracts";

import type { BlobStore } from "./ports.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const AUTHORITIES = new Set<ActionAuthority>(["none", "inform", "propose", "act"]);
const SOURCE_CLASS_SET = new Set<SourceClass>(SOURCE_CLASSES);
const RANK: Record<ActionAuthority, number> = { none: 0, inform: 1, propose: 2, act: 3 };

export interface EvidenceFact {
  kind: string;
  value: unknown;
  requestedAuthority?: ActionAuthority;
  authority?: ActionAuthority;
  validity?: { kind: string; at?: number };
}

export interface EvidenceAdmission {
  cursor: RuntimeCursor;
  operationId: string;
  observationId: string;
  rawBlobId: BlobRef;
  reducer: { id: string; revision: string };
  sourceClass: SourceClass;
  originSourceClass?: SourceClass;
  facts: readonly EvidenceFact[];
  observedAt: number;
  visibleText?: string;
  signal?: AbortSignal;
}

export interface EvidenceQuery {
  cursor: RuntimeCursor;
  text: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface SearchHit {
  evidenceId: string;
  kind: string;
  rank: number;
  snippet?: string;
}

export interface EvidenceRead {
  cursor: RuntimeCursor;
  evidenceId: string;
  range?: ByteRange;
  signal?: AbortSignal;
}

export interface ExactPage {
  evidenceId: string;
  rawBlobId: BlobRef;
  bytes: Uint8Array;
  byteLength: number;
  sha256: string;
  range: ByteRange;
  verified: true;
}

export interface EvidenceRepository {
  put(record: EvidenceRecord): Promise<void>;
  get(cursor: RuntimeCursor, id: string): Promise<EvidenceRecord | null>;
}

export interface EvidenceFtsIndex {
  upsert(record: EvidenceRecord, body: string): Promise<void>;
  search(query: EvidenceQuery): Promise<SearchHit[]>;
}

export interface EvidenceService {
  admit(input: EvidenceAdmission): Promise<EvidenceRecord[]>;
  search(q: EvidenceQuery): Promise<SearchHit[]>;
  read(req: EvidenceRead): Promise<ExactPage>;
}

export interface CreateEvidenceServiceInput {
  cursor: RuntimeCursor;
  repository: EvidenceRepository;
  fts: EvidenceFtsIndex;
  blobs: BlobStore;
}

export type EvidenceServiceErrorCode =
  | "PCR_EVIDENCE_DEPENDENCY_MISSING"
  | "PCR_EVIDENCE_INPUT_INVALID"
  | "PCR_EVIDENCE_INTEGRITY"
  | "PCR_EVIDENCE_NOT_FOUND"
  | "PCR_EVIDENCE_SCOPE_MISMATCH";

export class EvidenceServiceError extends TypeError {
  readonly code: EvidenceServiceErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EvidenceServiceErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "EvidenceServiceError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new EvidenceServiceError("PCR_EVIDENCE_INPUT_INVALID", { field });
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

function minAuthority(left: ActionAuthority, right: ActionAuthority): ActionAuthority {
  return RANK[left] <= RANK[right] ? left : right;
}

function parseAuthority(value: unknown, field: string): ActionAuthority {
  if (typeof value !== "string" || !AUTHORITIES.has(value as ActionAuthority)) failInput(field);
  return value as ActionAuthority;
}

function parseSourceClass(value: unknown, field: string): SourceClass {
  if (typeof value !== "string" || !SOURCE_CLASS_SET.has(value as SourceClass)) failInput(field);
  return value as SourceClass;
}

function collectText(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (value.length > 0) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectText(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) collectText(item, out);
  }
}

function indexBody(record: EvidenceRecord, visibleText: string | undefined): string {
  const parts = [record.kind];
  if (typeof visibleText === "string" && visibleText.length > 0) parts.push(visibleText);
  collectText(record.value, parts);
  parts.push(canonicalJson(record.value));
  return parts.join("\n");
}

function makeEvidenceId(observationId: string, index: number, fact: EvidenceFact): string {
  return `ev_${domainHash("evidence", {
    observationId,
    index,
    kind: fact.kind,
    value: fact.value,
  })}`;
}

function normalizeRange(range: ByteRange | undefined, byteLength: number): ByteRange {
  if (range === undefined) {
    return { start: 0, endExclusive: byteLength };
  }
  if (
    !range
    || typeof range !== "object"
    || !Number.isSafeInteger(range.start)
    || !Number.isSafeInteger(range.endExclusive)
    || range.start < 0
    || range.endExclusive < range.start
    || range.endExclusive > byteLength
  ) {
    failInput("req.range");
  }
  return { start: range.start, endExclusive: range.endExclusive };
}

class DefaultEvidenceService implements EvidenceService {
  readonly #cursor: Readonly<RuntimeCursor>;
  readonly #repository: EvidenceRepository;
  readonly #fts: EvidenceFtsIndex;
  readonly #blobs: BlobStore;

  constructor(input: CreateEvidenceServiceInput) {
    if (!input || typeof input !== "object") {
      throw new EvidenceServiceError("PCR_EVIDENCE_DEPENDENCY_MISSING", { dependency: "input" });
    }
    if (!input.cursor || typeof input.cursor !== "object") {
      throw new EvidenceServiceError("PCR_EVIDENCE_DEPENDENCY_MISSING", { dependency: "cursor" });
    }
    this.#cursor = snapshotCursor(input.cursor, "input.cursor");
    if (!input.repository || typeof input.repository.put !== "function" || typeof input.repository.get !== "function") {
      throw new EvidenceServiceError("PCR_EVIDENCE_DEPENDENCY_MISSING", { dependency: "repository" });
    }
    if (!input.fts || typeof input.fts.upsert !== "function" || typeof input.fts.search !== "function") {
      throw new EvidenceServiceError("PCR_EVIDENCE_DEPENDENCY_MISSING", { dependency: "fts" });
    }
    if (!input.blobs || typeof input.blobs.put !== "function" || typeof input.blobs.read !== "function") {
      throw new EvidenceServiceError("PCR_EVIDENCE_DEPENDENCY_MISSING", { dependency: "blobs" });
    }
    this.#repository = input.repository;
    this.#fts = input.fts;
    this.#blobs = input.blobs;
  }

  async admit(input: EvidenceAdmission): Promise<EvidenceRecord[]> {
    if (!input || typeof input !== "object") failInput("input");
    const cursor = snapshotCursor(input.cursor, "input.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
    }
    requireNonEmpty(input.operationId, "input.operationId");
    requireNonEmpty(input.observationId, "input.observationId");
    if (!isBlobId(input.rawBlobId)) failInput("input.rawBlobId");
    if (!input.reducer || typeof input.reducer !== "object") failInput("input.reducer");
    requireNonEmpty(input.reducer.id, "input.reducer.id");
    requireNonEmpty(input.reducer.revision, "input.reducer.revision");
    const declared = parseSourceClass(input.sourceClass, "input.sourceClass");
    const origin = input.originSourceClass === undefined
      ? declared
      : parseSourceClass(input.originSourceClass, "input.originSourceClass");
    if (!Number.isSafeInteger(input.observedAt) || input.observedAt < 0) failInput("input.observedAt");
    if (input.visibleText !== undefined && typeof input.visibleText !== "string") failInput("input.visibleText");
    if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("input.signal");
    if (!Array.isArray(input.facts) || input.facts.length === 0) failInput("input.facts");
    const ceiling = sourceAuthorityCeiling(origin);
    const records: EvidenceRecord[] = input.facts.map((fact, index) => {
      if (!fact || typeof fact !== "object") failInput(`input.facts[${index}]`);
      requireNonEmpty(fact.kind, `input.facts[${index}].kind`);
      const requested = fact.requestedAuthority ?? fact.authority ?? "inform";
      const authority = minAuthority(ceiling, parseAuthority(requested, `input.facts[${index}].authority`));
      const validity = fact.validity ?? { kind: "point", at: input.observedAt };
      if (!validity || typeof validity !== "object") failInput(`input.facts[${index}].validity`);
      requireNonEmpty(validity.kind, `input.facts[${index}].validity.kind`);
      if (
        validity.at !== undefined
        && (!Number.isSafeInteger(validity.at) || validity.at < 0)
      ) {
        failInput(`input.facts[${index}].validity.at`);
      }
      return {
        evidenceId: makeEvidenceId(input.observationId, index, fact),
        cursor,
        operationId: input.operationId,
        observationId: input.observationId,
        rawBlobId: input.rawBlobId,
        reducer: { id: input.reducer.id, revision: input.reducer.revision },
        kind: fact.kind,
        value: fact.value,
        sourceClass: origin,
        authority,
        sourceRefs: [input.rawBlobId],
        validity,
        contentHash: domainHash("evidence-payload", fact.value),
        observedAt: input.observedAt,
      };
    });
    input.signal?.throwIfAborted();
    for (const record of records) {
      input.signal?.throwIfAborted();
      await this.#repository.put(record);
      await this.#fts.upsert(record, indexBody(record, input.visibleText));
    }
    return records;
  }

  async search(query: EvidenceQuery): Promise<SearchHit[]> {
    if (!query || typeof query !== "object") failInput("query");
    const cursor = snapshotCursor(query.cursor, "query.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
    }
    requireNonEmpty(query.text, "query.text");
    if (query.signal !== undefined && !(query.signal instanceof AbortSignal)) failInput("query.signal");
    query.signal?.throwIfAborted();
    return this.#fts.search(query);
  }

  async read(req: EvidenceRead): Promise<ExactPage> {
    if (!req || typeof req !== "object") failInput("req");
    const cursor = snapshotCursor(req.cursor, "req.cursor");
    if (!sameCursor(cursor, this.#cursor)) {
      throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
    }
    requireNonEmpty(req.evidenceId, "req.evidenceId");
    if (req.signal !== undefined && !(req.signal instanceof AbortSignal)) failInput("req.signal");
    req.signal?.throwIfAborted();
    const record = await this.#repository.get(cursor, req.evidenceId);
    if (!record) throw new EvidenceServiceError("PCR_EVIDENCE_NOT_FOUND", { evidenceId: req.evidenceId });
    if (!sameCursor(record.cursor, cursor)) {
      throw new EvidenceServiceError("PCR_EVIDENCE_SCOPE_MISMATCH");
    }
    if (domainHash("evidence-payload", record.value) !== record.contentHash) {
      throw new EvidenceServiceError("PCR_EVIDENCE_INTEGRITY", { field: "contentHash" });
    }
    req.signal?.throwIfAborted();
    const full = await this.#blobs.read(cursor, record.rawBlobId);
    const byteLength = full.byteLength;
    const digest = createHash("sha256").update(full).digest("hex");
    const range = normalizeRange(req.range, byteLength);
    return {
      evidenceId: record.evidenceId,
      rawBlobId: record.rawBlobId,
      bytes: Uint8Array.from(full.subarray(range.start, range.endExclusive)),
      byteLength,
      sha256: digest,
      range,
      verified: true,
    };
  }
}

export function createEvidenceService(input: CreateEvidenceServiceInput): EvidenceService {
  return new DefaultEvidenceService(input);
}
