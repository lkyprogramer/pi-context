export interface WorkspaceSqliteMigration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const V1_SQL = `
CREATE TABLE workspace_meta (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY CHECK (length(evidence_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  operation_id TEXT NOT NULL CHECK (length(operation_id) > 0),
  observation_id TEXT NOT NULL CHECK (length(observation_id) > 0),
  raw_blob_id TEXT NOT NULL CHECK (length(raw_blob_id) > 0),
  reducer_id TEXT NOT NULL CHECK (length(reducer_id) > 0),
  reducer_revision TEXT NOT NULL CHECK (length(reducer_revision) > 0),
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  source_class TEXT NOT NULL CHECK (source_class IN (
    'system', 'authenticated-user', 'untrusted-user', 'trusted-tool',
    'untrusted-tool', 'external-content', 'agent-derived'
  )),
  authority TEXT NOT NULL CHECK (authority IN ('none', 'inform', 'propose', 'act')),
  source_refs_json TEXT NOT NULL CHECK (
    json_valid(source_refs_json) AND json_type(source_refs_json) = 'array' AND json_array_length(source_refs_json) > 0
  ),
  validity_json TEXT NOT NULL CHECK (
    json_valid(validity_json) AND json_type(validity_json) = 'object'
    AND typeof(json_extract(validity_json, '$.kind')) = 'text'
    AND length(json_extract(validity_json, '$.kind')) > 0
  ),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  observed_at INTEGER NOT NULL CHECK (observed_at >= 0)
) STRICT;

CREATE INDEX evidence_scope_lookup ON evidence (
  workspace_id,
  session_id,
  leaf_id,
  lineage_hash,
  model_key,
  evidence_id
);
`;

const V2_SQL = `
CREATE TABLE saga_journal (
  operation_id TEXT PRIMARY KEY CHECK (length(operation_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  kind TEXT NOT NULL CHECK (length(kind) > 0),
  source_content_hash TEXT NOT NULL CHECK (
    length(source_content_hash) = 64 AND source_content_hash NOT GLOB '*[^0-9a-f]*'
  ),
  host_correlation_id TEXT NOT NULL CHECK (length(host_correlation_id) > 0),
  raw_blob_id TEXT NOT NULL CHECK (
    length(raw_blob_id) = 69 AND substr(raw_blob_id, 1, 5) = 'blob_'
    AND substr(raw_blob_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  config_fingerprint TEXT NOT NULL CHECK (
    length(config_fingerprint) = 64 AND config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  state TEXT NOT NULL CHECK (
    state IN ('prepared', 'runtime_durable', 'host_visible', 'acknowledged', 'committed', 'stale', 'failed')
  ),
  host_id TEXT CHECK (host_id IS NULL OR length(host_id) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1)
) STRICT;

CREATE UNIQUE INDEX saga_scope_correlation ON saga_journal (
  workspace_id, session_id, ifnull(leaf_id, ''), lineage_hash, model_key, config_fingerprint, host_correlation_id
);

CREATE UNIQUE INDEX saga_scope_host_id ON saga_journal (
  workspace_id, session_id, ifnull(leaf_id, ''), lineage_hash, model_key, config_fingerprint, host_id
) WHERE host_id IS NOT NULL;

CREATE INDEX saga_session_recovery ON saga_journal (
  workspace_id,
  session_id,
  state,
  operation_id
);
`;

const V3_SQL = `
CREATE TABLE user_turn_ledger (
  receipt_id TEXT PRIMARY KEY CHECK (length(receipt_id) > 0),
  operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  raw_text_hash TEXT NOT NULL CHECK (length(raw_text_hash) = 64 AND raw_text_hash NOT GLOB '*[^0-9a-f]*'),
  raw_blob_id TEXT NOT NULL CHECK (
    length(raw_blob_id) = 69 AND substr(raw_blob_id, 1, 5) = 'blob_'
    AND substr(raw_blob_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  utf8_bytes INTEGER NOT NULL CHECK (utf8_bytes >= 0),
  source_class TEXT NOT NULL CHECK (source_class IN ('authenticated-user', 'untrusted-user', 'agent-derived')),
  captured_at INTEGER NOT NULL CHECK (captured_at >= 0),
  host_message_id TEXT CHECK (host_message_id IS NULL OR length(host_message_id) > 0),
  user_turn_id TEXT UNIQUE CHECK (user_turn_id IS NULL OR length(user_turn_id) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  CHECK ((host_message_id IS NULL) = (user_turn_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX user_turn_scope_host ON user_turn_ledger (
  workspace_id, session_id, ifnull(leaf_id, ''), lineage_hash, model_key, host_message_id
) WHERE host_message_id IS NOT NULL;

CREATE INDEX user_turn_pending ON user_turn_ledger (
  workspace_id, session_id, host_message_id, captured_at, receipt_id
);
`;

const V4_SQL = `
ALTER TABLE user_turn_ledger
  ADD COLUMN disposition TEXT NOT NULL DEFAULT 'pending'
  CHECK (disposition IN ('pending', 'handled', 'linked'));

UPDATE user_turn_ledger
SET disposition = 'linked'
WHERE host_message_id IS NOT NULL;

DROP INDEX user_turn_scope_host;

CREATE UNIQUE INDEX user_turn_session_host ON user_turn_ledger (
  workspace_id, session_id, host_message_id
) WHERE host_message_id IS NOT NULL;
`;

const V5_SQL = `
CREATE VIRTUAL TABLE evidence_fts USING fts5(
  evidence_id UNINDEXED,
  body,
  tokenize = 'unicode61'
);
`;

export const WORKSPACE_SQLITE_MIGRATIONS: readonly WorkspaceSqliteMigration[] = Object.freeze([
  Object.freeze({ version: 1, name: "workspace-evidence-v1", sql: V1_SQL }),
  Object.freeze({ version: 2, name: "workspace-saga-v2", sql: V2_SQL }),
  Object.freeze({ version: 3, name: "workspace-user-turn-v3", sql: V3_SQL }),
  Object.freeze({ version: 4, name: "workspace-user-turn-disposition-v4", sql: V4_SQL }),
  Object.freeze({ version: 5, name: "workspace-evidence-fts-v5", sql: V5_SQL }),
]);

export const WORKSPACE_SQLITE_SCHEMA_VERSION = WORKSPACE_SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
