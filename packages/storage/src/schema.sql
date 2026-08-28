PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE schema_meta (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL,
  checksum TEXT NOT NULL
) STRICT;

CREATE TABLE operation (
  operation_id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  host_ref TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT
) STRICT;

CREATE TABLE observation (
  observation_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES operation(operation_id),
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  raw_blob_id TEXT NOT NULL,
  reducer_id TEXT NOT NULL,
  reducer_revision TEXT NOT NULL,
  is_error INTEGER NOT NULL CHECK (is_error IN (0,1)),
  observed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE evidence (
  evidence_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  source_class TEXT NOT NULL,
  authority TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL
) STRICT;

CREATE TABLE directive (
  directive_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  source_input_id TEXT NOT NULL,
  quote TEXT NOT NULL,
  byte_start INTEGER NOT NULL,
  byte_end INTEGER NOT NULL,
  kind TEXT NOT NULL,
  polarity TEXT NOT NULL,
  status TEXT NOT NULL,
  scope_json TEXT NOT NULL
) STRICT;

CREATE TABLE claim (
  claim_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  polarity TEXT NOT NULL,
  status TEXT NOT NULL,
  authority TEXT NOT NULL,
  value_json TEXT NOT NULL,
  valid_start INTEGER,
  valid_end INTEGER,
  system_start INTEGER NOT NULL,
  system_end INTEGER
) STRICT;

CREATE TABLE claim_support (
  claim_id TEXT NOT NULL REFERENCES claim(claim_id),
  support_id TEXT NOT NULL,
  PRIMARY KEY (claim_id, support_id)
) STRICT;

CREATE TABLE continuity_revision (
  revision_id TEXT PRIMARY KEY,
  parent_revision_id TEXT,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE generation (
  generation_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  source_head TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE lease (
  lease_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at INTEGER NOT NULL
) STRICT;

CREATE TABLE fts_document (
  document_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  branch_scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  source_class TEXT NOT NULL,
  authority TEXT NOT NULL,
  body TEXT NOT NULL,
  timestamp INTEGER NOT NULL
) STRICT;

-- Created only after startup capability probe succeeds:
CREATE VIRTUAL TABLE IF NOT EXISTS fts_document_index USING fts5(body, content='fts_document', content_rowid='rowid');
