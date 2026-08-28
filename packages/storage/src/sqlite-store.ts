import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { domainHash, pcrError } from "../../contracts/src/index.js";
import type { EvidencePut, OpenStoreInput, StorageRpc, StorageTransaction, StoredEvidence } from "./protocol.js";
import { claimWriter, releaseWriter, StorageWorker } from "./worker.js";

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");

function wrapSqliteError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/busy|locked|SQLITE_BUSY|EIO|ENOSPC|EACCES|EROFS|no such file|not a directory|unable to open/i.test(message)) {
    throw pcrError("UNKNOWN_ENUM", { reason: "sqlite-io", message });
  }
  throw error;
}

class SqliteTransaction implements StorageTransaction {
  constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceId: string,
  ) {}

  async putEvidence(input: EvidencePut): Promise<void> {
    this.db.prepare(
      `INSERT INTO evidence (
        evidence_id, workspace_id, session_id, branch_scope, kind, source_class, authority, content_hash, payload_json, observed_at
      ) VALUES (?, ?, 's1', 'main', 'observation', 'trusted-tool', 'inform', ?, '{}', ?)`,
    ).run(input.evidenceId, this.workspaceId, input.contentHash, Date.now());
  }
}

export class SqliteStore implements StorageRpc {
  private readonly worker = new StorageWorker();

  constructor(
    private readonly db: DatabaseSync,
    private readonly workspaceId: string,
    private readonly path: string,
  ) {}

  async transaction<T>(work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    return this.worker.enqueue(async () => {
      try {
        this.db.exec("BEGIN IMMEDIATE");
        const value = await work(new SqliteTransaction(this.db, this.workspaceId));
        this.db.exec("COMMIT");
        return value;
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // ignore rollback failure after IO errors
        }
        wrapSqliteError(error);
      }
    });
  }

  async getEvidence(id: string): Promise<StoredEvidence | null> {
    const row = this.db
      .prepare("SELECT evidence_id, content_hash, workspace_id FROM evidence WHERE evidence_id = ? AND workspace_id = ?")
      .get(id, this.workspaceId) as { evidence_id: string; content_hash: string; workspace_id: string } | undefined;
    if (!row) return null;
    return { evidenceId: row.evidence_id, contentHash: row.content_hash, workspaceId: row.workspace_id };
  }

  async migrate(version: number, apply: () => Promise<void>): Promise<void> {
    try {
      await apply();
      this.db.prepare("INSERT OR REPLACE INTO schema_meta(version, applied_at, checksum) VALUES (?, ?, ?)").run(
        version,
        Date.now(),
        domainHash("schema", SCHEMA),
      );
    } catch (error) {
      throw error;
    }
  }

  async close(): Promise<void> {
    this.db.close();
    releaseWriter(this.path);
  }
}

export async function openSqliteStore(input: OpenStoreInput): Promise<SqliteStore> {
  claimWriter(input.path);
  try {
    const db = new DatabaseSync(input.path);
    const migrated = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'").get();
    if (!migrated) {
      db.exec(SCHEMA);
    }
    const checksum = domainHash("schema", SCHEMA);
    db.prepare("INSERT OR IGNORE INTO schema_meta(version, applied_at, checksum) VALUES (1, ?, ?)").run(Date.now(), checksum);
    return new SqliteStore(db, input.workspaceId, input.path);
  } catch (error) {
    releaseWriter(input.path);
    wrapSqliteError(error);
  }
}
