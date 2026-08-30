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

export const WORKSPACE_SQLITE_MIGRATIONS: readonly WorkspaceSqliteMigration[] = Object.freeze([
  Object.freeze({ version: 1, name: "workspace-evidence-v1", sql: V1_SQL }),
]);

export const WORKSPACE_SQLITE_SCHEMA_VERSION = WORKSPACE_SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
