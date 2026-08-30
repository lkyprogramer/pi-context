import type { EvidenceRecord, RuntimeCursor } from "@pcr/contracts";
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
    super(code, options);
    this.name = "EvidenceRepositoryError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface OpenWorkspaceEvidenceRepositoryInput {
  database: WorkspaceSqliteEvidenceStore;
}

function failInput(field: string): never {
  throw new EvidenceRepositoryError("PCR_EVIDENCE_REPOSITORY_INPUT_INVALID", { field });
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
    return this.#database.get(cursor, id);
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
