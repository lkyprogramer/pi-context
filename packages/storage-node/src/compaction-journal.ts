import { domainHash, type RuntimeCursor } from "@pcr/contracts";
import {
  CompactionJournalError,
  type CompactionJournal,
  type StagedCompactionRecord,
} from "@pcr/runtime";

import { getWorkspaceSqliteAccess } from "./internal/sqlite-access.js";
import { StorageNodeError, type WorkspaceSqliteEvidenceStore } from "./sqlite-store.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface OpenCompactionJournalInput {
  database: WorkspaceSqliteEvidenceStore;
}

function scope(cursor: RuntimeCursor): [string, string, string | null, string, string] {
  return [cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey];
}

function validateCursor(cursor: RuntimeCursor): RuntimeCursor {
  if (!cursor || typeof cursor !== "object") {
    throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "cursor" });
  }
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) {
    throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "cursor.workspaceId" });
  }
  if (typeof cursor.sessionId !== "string" || cursor.sessionId.length === 0) {
    throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "cursor.sessionId" });
  }
  if (!SHA256_PATTERN.test(cursor.lineageHash) || typeof cursor.modelKey !== "string" || cursor.modelKey.length === 0) {
    throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "cursor" });
  }
  return cursor;
}

function toRecord(row: {
  stage_id: string;
  workspace_id: string;
  session_id: string;
  leaf_id: string | null;
  lineage_hash: string;
  model_key: string;
  output_hash: string;
  first_kept_entry_id: string;
  payload_json: string;
  generation: number;
  state: StagedCompactionRecord["state"];
}): StagedCompactionRecord {
  return {
    stageId: row.stage_id,
    cursor: {
      workspaceId: row.workspace_id,
      sessionId: row.session_id,
      leafId: row.leaf_id,
      lineageHash: row.lineage_hash,
      modelKey: row.model_key,
    },
    outputHash: row.output_hash,
    firstKeptEntryId: row.first_kept_entry_id,
    payloadJson: row.payload_json,
    generation: row.generation,
    state: row.state,
  };
}

export function openWorkspaceCompactionJournal(input: OpenCompactionJournalInput): CompactionJournal {
  const access = getWorkspaceSqliteAccess(input.database);
  if (!access) throw new StorageNodeError("PCR_SQLITE_CLOSED");
  return {
    async stage(record) {
      record.signal?.throwIfAborted();
      const cursor = validateCursor(record.cursor);
      if (!SHA256_PATTERN.test(record.outputHash) || record.firstKeptEntryId.length === 0) {
        throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "stage" });
      }
      return access.transaction("compaction-stage", (db) => {
        db.prepare(
          `UPDATE compaction_stage SET state = 'failed'
           WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
             AND state = 'staged'`,
        ).run(...scope(cursor));
        const current = db.prepare(
          `SELECT COALESCE(MAX(generation), -1) AS generation FROM compaction_stage
           WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?`,
        ).get(...scope(cursor)) as { generation: number };
        const generation = current.generation + 1;
        const stageId = `cstage_${domainHash("compaction-stage", { cursor, outputHash: record.outputHash, generation })}`;
        db.prepare(
          `INSERT INTO compaction_stage (
            stage_id, workspace_id, session_id, leaf_id, lineage_hash, model_key,
            output_hash, first_kept_entry_id, payload_json, generation, state, recorded_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staged', ?)`,
        ).run(
          stageId,
          ...scope(cursor),
          record.outputHash,
          record.firstKeptEntryId,
          record.payloadJson,
          generation,
          record.now,
        );
        return toRecord({
          stage_id: stageId,
          workspace_id: cursor.workspaceId,
          session_id: cursor.sessionId,
          leaf_id: cursor.leafId,
          lineage_hash: cursor.lineageHash,
          model_key: cursor.modelKey,
          output_hash: record.outputHash,
          first_kept_entry_id: record.firstKeptEntryId,
          payload_json: record.payloadJson,
          generation,
          state: "staged",
        });
      });
    },
    async ack(input) {
      input.signal?.throwIfAborted();
      const cursor = validateCursor(input.cursor);
      if (!SHA256_PATTERN.test(input.outputHash) || input.firstKeptEntryId.length === 0) {
        throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_INPUT_INVALID", { field: "ack" });
      }
      return access.transaction("compaction-ack", (db) => {
        const pending = db.prepare(
          `SELECT * FROM compaction_stage
           WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
             AND state = 'staged'
           ORDER BY generation DESC LIMIT 1`,
        ).get(...scope(cursor)) as Parameters<typeof toRecord>[0] | undefined;
        if (!pending) throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_NOT_STAGED");
        if (pending.output_hash !== input.outputHash || pending.first_kept_entry_id !== input.firstKeptEntryId) {
          throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_HASH_MISMATCH", {
            expected: pending.output_hash,
            actual: input.outputHash,
          });
        }
        const updated = db.prepare(
          `UPDATE compaction_stage SET state = 'acked' WHERE stage_id = ? AND state = 'staged' AND generation = ?`,
        ).run(pending.stage_id, pending.generation) as { changes: number };
        if (updated.changes !== 1) {
          throw new CompactionJournalError("PCR_COMPACTION_JOURNAL_GENERATION_CONFLICT", {
            stageId: pending.stage_id,
            generation: pending.generation,
          });
        }
        return toRecord({ ...pending, state: "acked" });
      });
    },
    async fail(input) {
      input.signal?.throwIfAborted();
      const cursor = validateCursor(input.cursor);
      access.transaction("compaction-fail", (db) => {
        if (input.outputHash) {
          db.prepare(
            `UPDATE compaction_stage SET state = 'failed'
             WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
               AND output_hash = ? AND state = 'staged'`,
          ).run(...scope(cursor), input.outputHash);
          return;
        }
        db.prepare(
          `UPDATE compaction_stage SET state = 'failed'
           WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
             AND state = 'staged'`,
        ).run(...scope(cursor));
      });
    },
    async pending(cursorInput, signal) {
      signal?.throwIfAborted();
      const cursor = validateCursor(cursorInput);
      const row = access.read("compaction-pending", (db) => db.prepare(
        `SELECT * FROM compaction_stage
         WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?
           AND state = 'staged'
         ORDER BY generation DESC LIMIT 1`,
      ).get(...scope(cursor))) as Parameters<typeof toRecord>[0] | undefined;
      return row ? toRecord(row) : null;
    },
  };
}
