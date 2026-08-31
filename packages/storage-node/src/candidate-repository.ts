import { type RuntimeCursor } from "@pcr/contracts";
import {
  candidateIdFor,
  candidateKeyHash,
  type Candidate,
  type CandidateKey,
  type CandidatePhase,
  type CandidateRepository,
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
const PHASES = new Set<CandidatePhase>(["prepared", "stale", "committed"]);

interface CandidateRow {
  candidate_id: string;
  candidate_key: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  source_head: string;
  config_fingerprint: string;
  phase: CandidatePhase;
  reason: string | null;
  revision: number;
}

const CANDIDATE_COLUMNS = `
  candidate_id, candidate_key, workspace_id, session_id, leaf_id, lineage_hash,
  model_key, source_head, config_fingerprint, phase, reason, revision
`;

export interface OpenWorkspaceCandidateRepositoryInput {
  database: WorkspaceSqliteEvidenceStore;
}

export type CandidateRepositoryErrorCode =
  | "PCR_CANDIDATE_CLOSED"
  | "PCR_CANDIDATE_DEPENDENCY_MISSING"
  | "PCR_CANDIDATE_INPUT_INVALID"
  | "PCR_CANDIDATE_NOT_FOUND"
  | "PCR_CANDIDATE_SCOPE_MISMATCH"
  | "PCR_CANDIDATE_STORAGE_BUSY"
  | "PCR_CANDIDATE_STORAGE_FAILURE";

export class CandidateRepositoryError extends Error {
  readonly code: CandidateRepositoryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CandidateRepositoryErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code, options);
    this.name = "CandidateRepositoryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CandidateRepositoryError("PCR_CANDIDATE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CandidateRepositoryError("PCR_CANDIDATE_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotCursor(value: Pick<RuntimeCursor, "workspaceId" | "sessionId" | "leafId" | "lineageHash" | "modelKey">, field = "cursor"): RuntimeCursor {
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

function normalizeKey(value: CandidateKey, workspaceId: string): CandidateKey {
  if (!value || typeof value !== "object") failInput("key");
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal)) failInput("key.signal");
  const cursor = snapshotCursor(value, "key");
  if (!SHA256_PATTERN.test(value.sourceHead)) failInput("key.sourceHead");
  if (!SHA256_PATTERN.test(value.configFingerprint)) failInput("key.configFingerprint");
  if (cursor.workspaceId !== workspaceId) throw new CandidateRepositoryError("PCR_CANDIDATE_SCOPE_MISMATCH");
  return {
    workspaceId: cursor.workspaceId,
    sessionId: cursor.sessionId,
    leafId: cursor.leafId,
    lineageHash: cursor.lineageHash,
    modelKey: cursor.modelKey,
    sourceHead: value.sourceHead,
    configFingerprint: value.configFingerprint,
    signal: value.signal,
  };
}

function toCandidate(row: CandidateRow): Candidate {
  if (!PHASES.has(row.phase)) failInput("row.phase");
  const candidate: Candidate = {
    id: row.candidate_id,
    key: row.candidate_key,
    phase: row.phase,
    sourceHead: row.source_head,
  };
  if (row.reason) candidate.reason = row.reason;
  return candidate;
}

function mapStorageError(error: unknown): CandidateRepositoryError {
  if (error instanceof CandidateRepositoryError) return error;
  if (error instanceof Error && error.cause instanceof CandidateRepositoryError) return error.cause;
  if (error instanceof StorageNodeError) {
    if (error.code === "PCR_SQLITE_BUSY" || error.code === "PCR_SQLITE_WRITER_LOCKED") {
      return new CandidateRepositoryError("PCR_CANDIDATE_STORAGE_BUSY", {}, { cause: error });
    }
    if (error.code === "PCR_SQLITE_CLOSED") {
      return new CandidateRepositoryError("PCR_CANDIDATE_CLOSED", {}, { cause: error });
    }
  }
  return new CandidateRepositoryError("PCR_CANDIDATE_STORAGE_FAILURE", {}, { cause: error });
}

class WorkspaceCandidateRepository implements CandidateRepository {
  readonly #database: WorkspaceSqliteAccess;
  readonly #workspaceId: string;

  constructor(database: WorkspaceSqliteAccess) {
    this.#database = database;
    this.#workspaceId = database.workspaceId;
  }

  async prepare(input: CandidateKey): Promise<Candidate> {
    const key = normalizeKey(input, this.#workspaceId);
    key.signal?.throwIfAborted();
    const keyHash = candidateKeyHash(key);
    const id = candidateIdFor(keyHash);
    try {
      const row = this.#database.transaction("prepare-candidate", (db) => {
        const existing = db.prepare(`
          SELECT ${CANDIDATE_COLUMNS} FROM background_candidate WHERE candidate_id = ?
        `).get(id) as unknown as CandidateRow | undefined;
        if (existing && (existing.phase === "prepared" || existing.phase === "committed")) {
          return existing;
        }
        if (existing) {
          db.prepare(`
            UPDATE background_candidate
            SET workspace_id = ?, session_id = ?, leaf_id = ?, lineage_hash = ?, model_key = ?,
                source_head = ?, config_fingerprint = ?, phase = 'prepared', reason = NULL,
                revision = revision + 1
            WHERE candidate_id = ?
          `).run(
            key.workspaceId,
            key.sessionId,
            key.leafId,
            key.lineageHash,
            key.modelKey,
            key.sourceHead,
            key.configFingerprint,
            id,
          );
        } else {
          db.prepare(`
            INSERT INTO background_candidate (${CANDIDATE_COLUMNS})
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'prepared', NULL, 1)
          `).run(
            id,
            keyHash,
            key.workspaceId,
            key.sessionId,
            key.leafId,
            key.lineageHash,
            key.modelKey,
            key.sourceHead,
            key.configFingerprint,
          );
        }
        return db.prepare(`SELECT ${CANDIDATE_COLUMNS} FROM background_candidate WHERE candidate_id = ?`)
          .get(id) as unknown as CandidateRow;
      });
      return toCandidate(row);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async publish(id: string, expectedHead: string): Promise<boolean> {
    requireNonEmpty(id, "id");
    if (!SHA256_PATTERN.test(id)) failInput("id");
    if (!SHA256_PATTERN.test(expectedHead)) failInput("expectedHead");
    try {
      return this.#database.transaction("publish-candidate", (db) => {
        const existing = db.prepare(`
          SELECT ${CANDIDATE_COLUMNS} FROM background_candidate WHERE candidate_id = ?
        `).get(id) as unknown as CandidateRow | undefined;
        if (!existing) throw new CandidateRepositoryError("PCR_CANDIDATE_NOT_FOUND", { id });
        if (existing.workspace_id !== this.#workspaceId) {
          throw new CandidateRepositoryError("PCR_CANDIDATE_SCOPE_MISMATCH");
        }
        if (existing.phase === "committed") return true;
        if (existing.phase === "stale") return false;
        if (existing.source_head !== expectedHead) {
          db.prepare(`
            UPDATE background_candidate
            SET phase = 'stale', reason = 'head-changed', revision = revision + 1
            WHERE candidate_id = ?
          `).run(id);
          return false;
        }
        db.prepare(`
          UPDATE background_candidate
          SET phase = 'committed', reason = NULL, revision = revision + 1
          WHERE candidate_id = ?
        `).run(id);
        return true;
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async stale(id: string, reason: string): Promise<void> {
    requireNonEmpty(id, "id");
    if (!SHA256_PATTERN.test(id)) failInput("id");
    requireNonEmpty(reason, "reason");
    try {
      this.#database.transaction("stale-candidate", (db) => {
        const existing = db.prepare(`
          SELECT ${CANDIDATE_COLUMNS} FROM background_candidate WHERE candidate_id = ?
        `).get(id) as unknown as CandidateRow | undefined;
        if (!existing) throw new CandidateRepositoryError("PCR_CANDIDATE_NOT_FOUND", { id });
        if (existing.workspace_id !== this.#workspaceId) {
          throw new CandidateRepositoryError("PCR_CANDIDATE_SCOPE_MISMATCH");
        }
        if (existing.phase === "committed") failInput("phase");
        if (existing.phase === "stale") return;
        db.prepare(`
          UPDATE background_candidate
          SET phase = 'stale', reason = ?, revision = revision + 1
          WHERE candidate_id = ?
        `).run(reason, id);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async invalidateScope(cursorInput: RuntimeCursor, reason: string, signal?: AbortSignal): Promise<number> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
    signal?.throwIfAborted();
    const cursor = snapshotCursor(cursorInput, "cursor");
    if (cursor.workspaceId !== this.#workspaceId) {
      throw new CandidateRepositoryError("PCR_CANDIDATE_SCOPE_MISMATCH");
    }
    requireNonEmpty(reason, "reason");
    try {
      return this.#database.transaction("invalidate-candidate-scope", (db) => {
        const result = db.prepare(`
          UPDATE background_candidate
          SET phase = 'stale', reason = ?, revision = revision + 1
          WHERE workspace_id = ?
            AND session_id = ?
            AND leaf_id IS ?
            AND lineage_hash = ?
            AND model_key = ?
            AND phase = 'prepared'
        `).run(reason, cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey);
        return Number(result.changes ?? 0);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }
}

export async function openWorkspaceCandidateRepository(
  input: OpenWorkspaceCandidateRepositoryInput,
): Promise<CandidateRepository> {
  if (!input || typeof input !== "object" || !input.database || typeof input.database !== "object") {
    failMissing("database");
  }
  const access = getWorkspaceSqliteAccess(input.database);
  if (!access) failMissing("database");
  try {
    access.read("open-candidate", () => undefined);
  } catch (error) {
    throw mapStorageError(error);
  }
  return new WorkspaceCandidateRepository(access);
}
