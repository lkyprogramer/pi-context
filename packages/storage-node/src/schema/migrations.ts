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

const V6_SQL = `
CREATE TABLE background_candidate (
  candidate_id TEXT PRIMARY KEY CHECK (
    length(candidate_id) = 64 AND candidate_id NOT GLOB '*[^0-9a-f]*'
  ),
  candidate_key TEXT NOT NULL CHECK (
    length(candidate_key) = 64 AND candidate_key NOT GLOB '*[^0-9a-f]*'
  ),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  source_head TEXT NOT NULL CHECK (length(source_head) = 64 AND source_head NOT GLOB '*[^0-9a-f]*'),
  config_fingerprint TEXT NOT NULL CHECK (
    length(config_fingerprint) = 64 AND config_fingerprint NOT GLOB '*[^0-9a-f]*'
  ),
  phase TEXT NOT NULL CHECK (phase IN ('prepared', 'stale', 'committed')),
  reason TEXT CHECK (reason IS NULL OR length(reason) > 0),
  revision INTEGER NOT NULL CHECK (revision >= 1)
) STRICT;

CREATE UNIQUE INDEX background_candidate_active_key ON background_candidate (candidate_key)
  WHERE phase IN ('prepared', 'committed');

CREATE INDEX background_candidate_scope ON background_candidate (
  workspace_id,
  session_id,
  leaf_id,
  lineage_hash,
  model_key,
  phase,
  candidate_id
);
`;

const V7_SQL = `
CREATE TABLE directive_record (
  directive_id TEXT PRIMARY KEY CHECK (length(directive_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  user_turn_id TEXT NOT NULL CHECK (length(user_turn_id) > 0),
  exact_quote TEXT NOT NULL CHECK (length(exact_quote) > 0),
  quote_hash TEXT NOT NULL CHECK (length(quote_hash) = 64 AND quote_hash NOT GLOB '*[^0-9a-f]*'),
  utf8_start INTEGER NOT NULL CHECK (utf8_start >= 0),
  utf8_end INTEGER NOT NULL CHECK (utf8_end >= utf8_start),
  utf16_start INTEGER NOT NULL CHECK (utf16_start >= 0),
  utf16_end INTEGER NOT NULL CHECK (utf16_end >= utf16_start),
  code_point_start INTEGER NOT NULL CHECK (code_point_start >= 0),
  code_point_end INTEGER NOT NULL CHECK (code_point_end >= code_point_start),
  kind TEXT NOT NULL CHECK (kind IN ('goal', 'constraint', 'prohibition', 'correction', 'permission', 'format')),
  polarity TEXT NOT NULL CHECK (polarity IN ('must', 'must-not', 'may', 'is', 'is-not', 'unknown')),
  key TEXT CHECK (key IS NULL OR length(key) > 0),
  value TEXT CHECK (value IS NULL OR length(value) > 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'resolved', 'retracted', 'contested')),
  superseded_by TEXT CHECK (superseded_by IS NULL OR length(superseded_by) > 0),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT;

CREATE INDEX directive_record_scope ON directive_record (
  workspace_id, session_id, leaf_id, lineage_hash, model_key, status, directive_id
);

CREATE TABLE claim_record (
  claim_id TEXT PRIMARY KEY CHECK (length(claim_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  key TEXT NOT NULL CHECK (length(key) > 0),
  polarity TEXT NOT NULL CHECK (length(polarity) > 0),
  status TEXT NOT NULL CHECK (length(status) > 0),
  value_json TEXT NOT NULL CHECK (json_valid(value_json)),
  authority TEXT NOT NULL CHECK (authority IN ('none', 'inform', 'propose', 'act')),
  revision INTEGER NOT NULL CHECK (revision >= 1)
) STRICT;

CREATE UNIQUE INDEX claim_record_active_key ON claim_record (
  workspace_id, session_id, ifnull(leaf_id, ''), lineage_hash, model_key, key
) WHERE status = 'active';

CREATE TABLE continuity_revision (
  revision_id TEXT PRIMARY KEY CHECK (length(revision_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  parent_revision_id TEXT CHECK (parent_revision_id IS NULL OR length(parent_revision_id) > 0),
  content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
  task_fronts_json TEXT NOT NULL CHECK (json_valid(task_fronts_json) AND json_type(task_fronts_json) = 'object'),
  next_safe_actions_json TEXT NOT NULL CHECK (
    json_valid(next_safe_actions_json) AND json_type(next_safe_actions_json) = 'array'
  ),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT;

CREATE INDEX continuity_revision_scope ON continuity_revision (
  workspace_id, session_id, leaf_id, lineage_hash, model_key, recorded_at, revision_id
);

CREATE TABLE cache_receipt (
  view_id TEXT PRIMARY KEY CHECK (length(view_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  sections_json TEXT NOT NULL CHECK (json_valid(sections_json) AND json_type(sections_json) = 'array'),
  first_different_section TEXT CHECK (first_different_section IS NULL OR length(first_different_section) > 0),
  eligible_prefix_tokens INTEGER NOT NULL CHECK (eligible_prefix_tokens >= 0),
  previous_view_id TEXT CHECK (previous_view_id IS NULL OR length(previous_view_id) > 0),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT;

CREATE INDEX cache_receipt_scope ON cache_receipt (
  workspace_id, session_id, leaf_id, lineage_hash, model_key, recorded_at, view_id
);
`;

const V8_SQL = `
CREATE TABLE compaction_stage (
  stage_id TEXT PRIMARY KEY CHECK (length(stage_id) > 0),
  workspace_id TEXT NOT NULL CHECK (
    length(workspace_id) = 43 AND substr(workspace_id, 1, 3) = 'ws_' AND substr(workspace_id, 4) NOT GLOB '*[^0-9a-f]*'
  ),
  session_id TEXT NOT NULL CHECK (length(session_id) > 0),
  leaf_id TEXT CHECK (leaf_id IS NULL OR length(leaf_id) > 0),
  lineage_hash TEXT NOT NULL CHECK (length(lineage_hash) = 64 AND lineage_hash NOT GLOB '*[^0-9a-f]*'),
  model_key TEXT NOT NULL CHECK (length(model_key) > 0),
  output_hash TEXT NOT NULL CHECK (length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*'),
  first_kept_entry_id TEXT NOT NULL CHECK (length(first_kept_entry_id) > 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  generation INTEGER NOT NULL CHECK (generation >= 0),
  state TEXT NOT NULL CHECK (state IN ('staged', 'acked', 'failed')),
  recorded_at INTEGER NOT NULL CHECK (recorded_at >= 0)
) STRICT;

CREATE INDEX compaction_stage_scope ON compaction_stage (
  workspace_id, session_id, leaf_id, lineage_hash, model_key, generation, recorded_at
);
`;

export const WORKSPACE_SQLITE_MIGRATIONS: readonly WorkspaceSqliteMigration[] = Object.freeze([
  Object.freeze({ version: 1, name: "workspace-evidence-v1", sql: V1_SQL }),
  Object.freeze({ version: 2, name: "workspace-saga-v2", sql: V2_SQL }),
  Object.freeze({ version: 3, name: "workspace-user-turn-v3", sql: V3_SQL }),
  Object.freeze({ version: 4, name: "workspace-user-turn-disposition-v4", sql: V4_SQL }),
  Object.freeze({ version: 5, name: "workspace-evidence-fts-v5", sql: V5_SQL }),
  Object.freeze({ version: 6, name: "workspace-background-candidate-v6", sql: V6_SQL }),
  Object.freeze({ version: 7, name: "workspace-runtime-state-v7", sql: V7_SQL }),
  Object.freeze({ version: 8, name: "workspace-compaction-stage-v8", sql: V8_SQL }),
]);

export const WORKSPACE_SQLITE_SCHEMA_VERSION = WORKSPACE_SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
