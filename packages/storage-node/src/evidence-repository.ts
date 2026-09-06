import { canonicalJson, isBlobId, type EvidenceRecord, type RuntimeCursor } from "@pcr/contracts";
import {
  parseSourceEntryId,
  sourceCallRef,
  sourceEntryRef,
} from "@pcr/core";
import type { EvidenceRepository } from "@pcr/runtime";

import { getWorkspaceSqliteAccess } from "./internal/sqlite-access.js";
import {
  StorageNodeError,
  type WorkspaceSqliteEvidenceStore,
} from "./sqlite-store.js";

export type EvidenceRepositoryErrorCode =
  | "PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING"
  | "PCR_EVIDENCE_REPOSITORY_INPUT_INVALID";

export class EvidenceRepositoryError extends Error {
  readonly code: EvidenceRepositoryErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EvidenceRepositoryErrorCode, details: Record<string, unknown> = {}, options?: ErrorOptions) {
    super(code);
    this.name = "EvidenceRepositoryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface OpenWorkspaceEvidenceRepositoryInput {
  database: WorkspaceSqliteEvidenceStore;
}

const EVIDENCE_COLUMNS = `
  evidence_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
  operation_id, observation_id, raw_blob_id, reducer_id, reducer_revision,
  kind, value_json, source_class, authority, source_refs_json, validity_json,
  content_hash, observed_at
`;

interface EvidenceRow {
  evidence_id: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  operation_id: string;
  observation_id: string;
  raw_blob_id: string;
  reducer_id: string;
  reducer_revision: string;
  kind: string;
  value_json: string;
  source_class: EvidenceRecord["sourceClass"];
  authority: EvidenceRecord["authority"];
  source_refs_json: string;
  validity_json: string;
  content_hash: string;
  observed_at: number;
}

function failInput(field: string): never {
  throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function toEvidenceRecord(row: EvidenceRow): EvidenceRecord {
  if (!isBlobId(row.raw_blob_id)) failInput("row.raw_blob_id");
  const sourceRefs = JSON.parse(row.source_refs_json) as string[];
  const sourceEntryId = parseSourceEntryId(sourceRefs);
  return {
    evidenceId: row.evidence_id,
    cursor: {
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      leafId: row.leaf_id,
      lineageHash: row.lineage_hash,
      modelKey: row.model_key,
    },
    operationId: row.operation_id,
    observationId: row.observation_id,
    rawBlobId: row.raw_blob_id,
    reducer: { id: row.reducer_id, revision: row.reducer_revision },
    kind: row.kind,
    value: JSON.parse(row.value_json) as unknown,
    sourceClass: row.source_class,
    authority: row.authority,
    sourceRefs,
    validity: JSON.parse(row.validity_json) as EvidenceRecord["validity"],
    contentHash: row.content_hash,
    observedAt: row.observed_at,
    ...(sourceEntryId === undefined ? {} : { sourceEntryId }),
  };
}

class WorkspaceEvidenceRepository implements EvidenceRepository {
  readonly #database: WorkspaceSqliteEvidenceStore;

  constructor(database: WorkspaceSqliteEvidenceStore) {
    this.#database = database;
  }

  async put(record: EvidenceRecord): Promise<void> {
    await this.#database.put(record);
  }

  async get(cursor: RuntimeCursor, id: string): Promise<EvidenceRecord | null> {
    requireNonEmpty(id, "id");
    requireNonEmpty(cursor?.workspaceId, "cursor.workspaceId");
    requireNonEmpty(cursor?.sessionId, "cursor.sessionId");
    const access = getWorkspaceSqliteAccess(this.#database);
    if (!access) {
      throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING", { dependency: "database" });
    }
    try {
      const row = access.read("get-evidence-by-identity", (db) => db.prepare(`
        SELECT ${EVIDENCE_COLUMNS}
        FROM evidence
        WHERE evidence_id = ?
          AND workspace_id = ?
          AND session_id = ?
      `).get(id, cursor.workspaceId, cursor.sessionId) as unknown as EvidenceRow | undefined);
      return row ? toEvidenceRecord(row) : null;
    } catch (error) {
      if (error instanceof EvidenceRepositoryError) throw error;
      throw error;
    }
  }

  async bindSourceEntry(cursor: RuntimeCursor, evidenceId: string, sourceEntryId: string): Promise<boolean> {
    requireNonEmpty(evidenceId, "evidenceId");
    requireNonEmpty(sourceEntryId, "sourceEntryId");
    requireNonEmpty(cursor?.workspaceId, "cursor.workspaceId");
    requireNonEmpty(cursor?.sessionId, "cursor.sessionId");
    const access = getWorkspaceSqliteAccess(this.#database);
    if (!access) {
      throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING", { dependency: "database" });
    }
    const bound = sourceEntryRef(sourceEntryId);
    return access.transaction("bind-evidence-source-entry", (db) => {
      const row = db.prepare(`
        SELECT ${EVIDENCE_COLUMNS}
        FROM evidence
        WHERE evidence_id = ?
          AND workspace_id = ?
          AND session_id = ?
      `).get(evidenceId, cursor.workspaceId, cursor.sessionId) as unknown as EvidenceRow | undefined;
      if (!row) return false;
      const refs = JSON.parse(row.source_refs_json) as string[];
      const existing = parseSourceEntryId(refs);
      if (existing === sourceEntryId) return true;
      if (existing !== undefined) return false;
      const next = [...refs, bound];
      db.prepare(`
        UPDATE evidence
        SET source_refs_json = ?
        WHERE evidence_id = ?
          AND workspace_id = ?
          AND session_id = ?
      `).run(canonicalJson(next), evidenceId, cursor.workspaceId, cursor.sessionId);
      return true;
    });
  }

  async listByCallId(cursor: RuntimeCursor, toolCallId: string): Promise<string[]> {
    requireNonEmpty(toolCallId, "toolCallId");
    requireNonEmpty(cursor?.workspaceId, "cursor.workspaceId");
    requireNonEmpty(cursor?.sessionId, "cursor.sessionId");
    const access = getWorkspaceSqliteAccess(this.#database);
    if (!access) {
      throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING", { dependency: "database" });
    }
    const callRef = sourceCallRef(toolCallId);
    const rows = access.read("list-evidence-by-call", (db) => db.prepare(`
      SELECT evidence.evidence_id AS evidence_id
      FROM evidence, json_each(evidence.source_refs_json)
      WHERE evidence.workspace_id = ?
        AND evidence.session_id = ?
        AND json_each.value = ?
    `).all(cursor.workspaceId, cursor.sessionId, callRef) as Array<{ evidence_id: string }>);
    return rows.map((row) => row.evidence_id);
  }
}

export function openWorkspaceEvidenceRepository(
  input: OpenWorkspaceEvidenceRepositoryInput,
): EvidenceRepository {
  if (!input || typeof input !== "object") failInput("input");
  if (
    !input.database
    || typeof input.database !== "object"
    || typeof input.database.put !== "function"
    || typeof input.database.get !== "function"
  ) {
    throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING", { dependency: "database" });
  }
  const access = getWorkspaceSqliteAccess(input.database);
  if (!access) {
    throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING", { dependency: "database" });
  }
  try {
    access.read("open-evidence-repository", () => undefined);
  } catch (error) {
    if (error instanceof StorageNodeError && error.code === "PCR_SQLITE_INPUT_INVALID") {
      throw new EvidenceRepositoryError(
        "PCR_EVIDENCE_REPOSITORY_DEPENDENCY_MISSING",
        { dependency: "database" },
        { cause: error },
      );
    }
    throw error;
  }
  return new WorkspaceEvidenceRepository(input.database);
}
