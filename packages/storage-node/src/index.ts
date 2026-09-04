export * from "./sqlite-store.js";
export * from "./schema/migrations.js";
export * from "./blob/contracts.js";
export * from "./blob/key-provider.js";
export * from "./blob/store.js";
export * from "./saga-store.js";
export * from "./user-turn-store.js";
export * from "./evidence-repository.js";
export * from "./fts-index.js";
export * from "./candidate-repository.js";
export * from "./state-store.js";
export * from "./compaction-journal.js";

import type { RuntimeCursor } from "@pcr/contracts";
import type { LeaseRecord, LeaseStore } from "@pcr/runtime";
import { getWorkspaceSqliteAccess, type WorkspaceSqliteAccess } from "./internal/sqlite-access.js";
import { StorageNodeError, type WorkspaceSqliteEvidenceStore } from "./sqlite-store.js";

export interface OpenWorkspaceRecallLeaseStoreInput {
  database: WorkspaceSqliteEvidenceStore;
}

export interface RecallLeaseStore extends LeaseStore {
  consume(
    cursor: RuntimeCursor,
    leaseId: string,
    input?: { now?: number; tokenTurns?: number },
  ): Promise<LeaseRecord | null>;
  revoke(cursor: RuntimeCursor, leaseId: string): Promise<boolean>;
}

const LEASE_SCOPE_COLUMNS = "workspace_id, session_id, leaf_id, lineage_hash, model_key";
const LEASE_COLUMNS = `lease_id, ${LEASE_SCOPE_COLUMNS}, page_id, purpose, authority,
  turns, token_turns, issued_at_ms, expires_at_ms, remaining_uses, status`;
const LEASE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS recall_lease (
    lease_id TEXT PRIMARY KEY CHECK (length(lease_id) > 0),
    workspace_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    leaf_id TEXT,
    lineage_hash TEXT NOT NULL,
    model_key TEXT NOT NULL,
    page_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    authority TEXT NOT NULL CHECK (authority = 'inform'),
    turns INTEGER NOT NULL CHECK (turns >= 0),
    token_turns INTEGER NOT NULL CHECK (token_turns >= 0),
    issued_at_ms INTEGER NOT NULL CHECK (issued_at_ms >= 0),
    expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= issued_at_ms),
    remaining_uses INTEGER NOT NULL CHECK (remaining_uses >= 0),
    status TEXT NOT NULL CHECK (status IN ('active','consumed','expired','revoked'))
  ) STRICT;
  CREATE INDEX IF NOT EXISTS recall_lease_scope ON recall_lease
    (workspace_id, session_id, leaf_id, lineage_hash, model_key, status, lease_id);
  CREATE INDEX IF NOT EXISTS recall_lease_page ON recall_lease
    (workspace_id, session_id, leaf_id, lineage_hash, model_key, page_id, status);
`;

function leaseInput(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field });
  }
}

function leaseCursor(value: RuntimeCursor, field = "cursor"): RuntimeCursor {
  if (!value || typeof value !== "object") {
    throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field });
  }
  leaseInput(value.workspaceId, `${field}.workspaceId`);
  leaseInput(value.sessionId, `${field}.sessionId`);
  leaseInput(value.lineageHash, `${field}.lineageHash`);
  leaseInput(value.modelKey, `${field}.modelKey`);
  if (value.leafId !== null) leaseInput(value.leafId, `${field}.leafId`);
  return {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
}

function leaseScope(cursor: RuntimeCursor): [string, string, string | null, string, string] {
  return [cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey];
}

function sameLeaseCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function toLease(row: Record<string, unknown>): LeaseRecord {
  return {
    leaseId: String(row.lease_id),
    pageId: String(row.page_id),
    purpose: String(row.purpose),
    authority: "inform",
    turns: Number(row.turns),
    tokenTurns: Number(row.token_turns),
    expiresAt: Number(row.expires_at_ms),
    remainingUses: Number(row.remaining_uses),
    status: row.status as LeaseRecord["status"],
    issuedAt: Number(row.issued_at_ms),
    cursor: {
      workspaceId: String(row.workspace_id),
      sessionId: String(row.session_id),
      leafId: (row.leaf_id as string | null) ?? null,
      lineageHash: String(row.lineage_hash),
      modelKey: String(row.model_key),
    },
  };
}

function leaseAccess(database: WorkspaceSqliteEvidenceStore): WorkspaceSqliteAccess {
  const access = getWorkspaceSqliteAccess(database);
  if (!access) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "database" });
  return access;
}

/** Durable, cursor-scoped recall lease store backed by the workspace SQLite database. */
export function openWorkspaceRecallLeaseStore(input: OpenWorkspaceRecallLeaseStoreInput): RecallLeaseStore {
  if (!input || typeof input !== "object" || !input.database) {
    throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "database" });
  }
  const access = leaseAccess(input.database);
  access.transaction("open-recall-lease-store", (db) => db.exec(LEASE_TABLE_SQL));
  const boundWorkspace = access.workspaceId;
  const bound = (value: RuntimeCursor): RuntimeCursor => {
    const cursor = leaseCursor(value);
    if (cursor.workspaceId !== boundWorkspace) {
      throw new StorageNodeError("PCR_SQLITE_WORKSPACE_MISMATCH", {
        expectedWorkspaceId: boundWorkspace,
        actualWorkspaceId: cursor.workspaceId,
      });
    }
    return cursor;
  };
  const rowFor = (db: Parameters<WorkspaceSqliteAccess["read"]>[1] extends (db: infer T) => unknown ? T : never, cursor: RuntimeCursor, leaseId: string) => (
    db.prepare(`SELECT ${LEASE_COLUMNS} FROM recall_lease WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ?`)
      .get(leaseId, ...leaseScope(cursor)) as Record<string, unknown> | undefined
  );
  return {
    async put(lease) {
      const cursor = bound(lease.cursor);
      leaseInput(lease.leaseId, "lease.leaseId");
      leaseInput(lease.pageId, "lease.pageId");
      leaseInput(lease.purpose, "lease.purpose");
      if (!Number.isSafeInteger(lease.turns) || lease.turns < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "lease.turns" });
      if (!Number.isSafeInteger(lease.tokenTurns) || lease.tokenTurns < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "lease.tokenTurns" });
      if (!Number.isSafeInteger(lease.expiresAt) || lease.expiresAt < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "lease.expiresAt" });
      if (!Number.isSafeInteger(lease.remainingUses) || lease.remainingUses < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "lease.remainingUses" });
      const issuedAt = lease.issuedAt ?? Math.max(0, lease.expiresAt);
      const status = lease.status ?? (lease.remainingUses > 0 ? "active" : "consumed");
      access.transaction("put-recall-lease", (db) => {
        db.prepare(`INSERT INTO recall_lease (${LEASE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(lease_id) DO UPDATE SET page_id = excluded.page_id, purpose = excluded.purpose,
          turns = excluded.turns, token_turns = excluded.token_turns, issued_at_ms = excluded.issued_at_ms,
          expires_at_ms = excluded.expires_at_ms, remaining_uses = excluded.remaining_uses, status = excluded.status
          WHERE recall_lease.workspace_id = excluded.workspace_id AND recall_lease.session_id = excluded.session_id
            AND recall_lease.leaf_id IS excluded.leaf_id AND recall_lease.lineage_hash = excluded.lineage_hash
            AND recall_lease.model_key = excluded.model_key`).run(
          lease.leaseId, cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey,
          lease.pageId, lease.purpose, "inform", lease.turns, lease.tokenTurns, issuedAt, lease.expiresAt,
          lease.remainingUses, status,
        );
      });
    },
    async get(scopeInput, leaseId) {
      const cursor = bound(scopeInput); leaseInput(leaseId, "leaseId");
      return access.transaction("get-recall-lease", (db) => {
        const row = rowFor(db, cursor, leaseId);
        if (!row) return null;
        const lease = toLease(row);
        const now = Date.now();
        if (lease.status === "active" && lease.expiresAt <= now) {
          db.prepare("UPDATE recall_lease SET status = 'expired' WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active' AND expires_at_ms <= ?")
            .run(leaseId, ...leaseScope(cursor), now);
          return { ...lease, status: "expired" };
        }
        return lease.status === "active" ? lease : null;
      });
    },
    async findByPage(scopeInput, pageId, requestedNow) {
      const cursor = bound(scopeInput); leaseInput(pageId, "pageId");
      return access.transaction("find-recall-lease-page", (db) => {
        const row = db.prepare(`SELECT ${LEASE_COLUMNS} FROM recall_lease WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND page_id = ? AND status = 'active' ORDER BY issued_at_ms DESC, lease_id DESC LIMIT 1`).get(...leaseScope(cursor), pageId) as Record<string, unknown> | undefined;
        if (!row) return null;
        const lease = toLease(row);
        const now = requestedNow ?? Date.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "now" });
        if (lease.expiresAt <= now || lease.remainingUses <= 0) {
          db.prepare("UPDATE recall_lease SET status = CASE WHEN remaining_uses <= 0 THEN 'consumed' ELSE 'expired' END WHERE lease_id = ? AND status = 'active'").run(lease.leaseId);
          return null;
        }
        return lease;
      });
    },
    async delete(scopeInput, leaseId) {
      const cursor = bound(scopeInput); leaseInput(leaseId, "leaseId");
      access.transaction("delete-recall-lease", (db) => {
        db.prepare("UPDATE recall_lease SET status = 'revoked' WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active'").run(leaseId, ...leaseScope(cursor));
      });
    },
    async list(scopeInput, requestedNow) {
      const cursor = bound(scopeInput);
      return access.transaction("list-recall-leases", (db) => {
        const now = requestedNow ?? Date.now();
        if (!Number.isSafeInteger(now) || now < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "now" });
        db.prepare("UPDATE recall_lease SET status = 'expired' WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active' AND expires_at_ms <= ?").run(...leaseScope(cursor), now);
        return (db.prepare(`SELECT ${LEASE_COLUMNS} FROM recall_lease WHERE workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active' AND remaining_uses > 0 ORDER BY issued_at_ms, lease_id`).all(...leaseScope(cursor)) as Record<string, unknown>[]).map(toLease).filter((lease) => sameLeaseCursor(lease.cursor, cursor));
      });
    },
    async consume(scopeInput, leaseId, consumeInput = {}) {
      const cursor = bound(scopeInput); leaseInput(leaseId, "leaseId");
      const now = consumeInput.now ?? Date.now();
      const tokenTurns = consumeInput.tokenTurns ?? 0;
      if (!Number.isSafeInteger(now) || now < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "now" });
      if (!Number.isSafeInteger(tokenTurns) || tokenTurns < 0) throw new StorageNodeError("PCR_SQLITE_INPUT_INVALID", { field: "tokenTurns" });
      return access.transaction("consume-recall-lease", (db) => {
        const result = db.prepare("UPDATE recall_lease SET remaining_uses = remaining_uses - 1, turns = turns + 1, token_turns = token_turns + ?, status = CASE WHEN remaining_uses - 1 <= 0 THEN 'consumed' ELSE 'active' END WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active' AND remaining_uses > 0 AND expires_at_ms > ?").run(tokenTurns, leaseId, ...leaseScope(cursor), now);
        if (Number(result.changes) !== 1) {
          db.prepare("UPDATE recall_lease SET status = 'expired' WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active' AND expires_at_ms <= ?").run(leaseId, ...leaseScope(cursor), now);
          return null;
        }
        const row = rowFor(db, cursor, leaseId);
        return row ? toLease(row) : null;
      });
    },
    async revoke(scopeInput, leaseId) {
      const cursor = bound(scopeInput); leaseInput(leaseId, "leaseId");
      return access.transaction("revoke-recall-lease", (db) => {
        const result = db.prepare("UPDATE recall_lease SET status = 'revoked' WHERE lease_id = ? AND workspace_id = ? AND session_id = ? AND leaf_id IS ? AND lineage_hash = ? AND model_key = ? AND status = 'active'").run(leaseId, ...leaseScope(cursor));
        return Number(result.changes) === 1;
      });
    },
  };
}
