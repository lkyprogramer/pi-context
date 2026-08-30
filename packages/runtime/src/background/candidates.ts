import { domainHash, type RuntimeCursor } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export type CandidatePhase = "prepared" | "stale" | "committed";

export interface CandidateKey {
  workspaceId: string;
  sessionId: string;
  leafId: string | null;
  lineageHash: string;
  modelKey: string;
  sourceHead: string;
  configFingerprint: string;
  signal?: AbortSignal;
}

export interface Candidate {
  id: string;
  key: string;
  phase: CandidatePhase;
  sourceHead: string;
  reason?: string;
}

export interface CandidateRepository {
  prepare(key: CandidateKey): Promise<Candidate>;
  publish(id: string, expectedHead: string): Promise<boolean>;
  stale(id: string, reason: string): Promise<void>;
}

export interface CreateCandidateKeyInput {
  cursor: RuntimeCursor;
  sourceHead: string;
  configFingerprint: string;
  signal?: AbortSignal;
}

export type CandidateKeyErrorCode =
  | "PCR_CANDIDATE_DEPENDENCY_MISSING"
  | "PCR_CANDIDATE_INPUT_INVALID";

export class CandidateKeyError extends TypeError {
  readonly code: CandidateKeyErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CandidateKeyErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CandidateKeyError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CandidateKeyError("PCR_CANDIDATE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CandidateKeyError("PCR_CANDIDATE_INPUT_INVALID", { field });
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
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return cursor;
}

export function candidateKeyHash(key: Omit<CandidateKey, "signal">): string {
  return domainHash("candidate-key", {
    workspaceId: key.workspaceId,
    sessionId: key.sessionId,
    leafId: key.leafId,
    lineageHash: key.lineageHash,
    modelKey: key.modelKey,
    sourceHead: key.sourceHead,
    configFingerprint: key.configFingerprint,
  });
}

export function candidateIdFor(keyHash: string): string {
  return domainHash("candidate-id", { key: keyHash });
}

export function createCandidateKey(input: CreateCandidateKeyInput): CandidateKey {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!SHA256_PATTERN.test(input.sourceHead)) failInput("sourceHead");
  if (!SHA256_PATTERN.test(input.configFingerprint)) failInput("configFingerprint");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  const cursor = snapshotCursor(input.cursor);
  return {
    workspaceId: cursor.workspaceId,
    sessionId: cursor.sessionId,
    leafId: cursor.leafId,
    lineageHash: cursor.lineageHash,
    modelKey: cursor.modelKey,
    sourceHead: input.sourceHead,
    configFingerprint: input.configFingerprint,
    signal: input.signal,
  };
}
