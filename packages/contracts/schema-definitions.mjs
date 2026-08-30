const draft = "https://json-schema.org/draft/2020-12/schema";
const identifier = { type: "string", minLength: 1 };
const hash = { type: "string", pattern: "^[0-9a-f]{64}$" };
const range = {
  type: "object",
  additionalProperties: false,
  required: ["start", "end"],
  properties: {
    start: { type: "integer", minimum: 0 },
    end: { type: "integer", minimum: 0 },
  },
};

export const SOURCE_CLASS_VALUES = [
  "system",
  "authenticated-user",
  "untrusted-user",
  "trusted-tool",
  "untrusted-tool",
  "external-content",
  "agent-derived",
];

export const runtimeCursorSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/runtime-cursor.schema.json",
  title: "RuntimeCursor",
  type: "object",
  additionalProperties: false,
  required: ["workspaceId", "sessionId", "leafId", "lineageHash", "modelKey"],
  properties: {
    workspaceId: identifier,
    sessionId: identifier,
    leafId: { anyOf: [identifier, { type: "null" }] },
    lineageHash: hash,
    modelKey: identifier,
  },
};

export const sourceClassSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/source-class.schema.json",
  title: "SourceClass",
  type: "string",
  enum: SOURCE_CLASS_VALUES,
};

export const userTurnRecordSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/user-turn-record.schema.json",
  title: "UserTurnRecord",
  type: "object",
  additionalProperties: false,
  required: ["userTurnId", "cursor", "rawTextHash", "rawBlobId", "utf8Bytes", "sourceClass", "capturedAt"],
  properties: {
    userTurnId: identifier,
    cursor: { $ref: "runtime-cursor.schema.json" },
    rawTextHash: hash,
    rawBlobId: identifier,
    utf8Bytes: { type: "integer", minimum: 0 },
    hostMessageId: identifier,
    sourceClass: { enum: ["authenticated-user", "untrusted-user"] },
    capturedAt: { type: "integer", minimum: 0 },
  },
};

export const directiveRecordSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/directive-record.schema.json",
  title: "DirectiveRecord",
  type: "object",
  additionalProperties: false,
  required: [
    "directiveId",
    "userTurnId",
    "exactQuote",
    "quoteHash",
    "utf8ByteRange",
    "utf16Range",
    "codePointRange",
    "kind",
    "polarity",
    "status",
  ],
  properties: {
    directiveId: identifier,
    userTurnId: identifier,
    exactQuote: { type: "string", minLength: 1 },
    quoteHash: hash,
    utf8ByteRange: range,
    utf16Range: range,
    codePointRange: range,
    kind: { enum: ["goal", "constraint", "prohibition", "correction", "permission", "format"] },
    polarity: { enum: ["must", "must-not", "may", "is", "is-not", "unknown"] },
    key: { type: "string", minLength: 1 },
    value: { type: "string" },
    status: { enum: ["active", "superseded", "resolved", "retracted", "contested"] },
    supersededBy: identifier,
  },
};

export const evidenceReceiptSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/evidence-receipt.schema.json",
  title: "EvidenceReceipt",
  type: "object",
  additionalProperties: false,
  required: ["evidenceId", "cursor", "sourceClass", "authority", "contentHash", "blobId", "observedAt"],
  properties: {
    evidenceId: identifier,
    cursor: { $ref: "runtime-cursor.schema.json" },
    sourceClass: { $ref: "source-class.schema.json" },
    authority: { enum: ["none", "inform", "propose", "act"] },
    contentHash: hash,
    blobId: identifier,
    observedAt: { type: "integer", minimum: 0 },
  },
};

export const checkpointV2Schema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/checkpoint-v2.schema.json",
  title: "CheckpointV2",
  type: "object",
  additionalProperties: false,
  required: ["version", "snapshotHash", "directives", "continuity", "claims", "pointers", "heads"],
  properties: {
    version: { const: 2 },
    snapshotHash: hash,
    directives: { type: "array", items: { $ref: "directive-record.schema.json" } },
    continuity: { type: "object" },
    claims: { type: "array", items: { type: "object" } },
    pointers: { type: "array", items: { type: "object" } },
    heads: { type: "object", additionalProperties: { type: "string" } },
  },
};

export const runtimeConfigSchema = {
  $schema: draft,
  $id: "https://pi-context.dev/schemas/runtime-config.schema.json",
  title: "RuntimeConfigV2",
  type: "object",
  additionalProperties: false,
  required: ["dataRoot", "ingress", "materialization", "compaction", "retrieval", "semantic"],
  properties: {
    dataRoot: { type: "string", minLength: 1 },
    ingress: { type: "object" },
    materialization: { type: "object" },
    compaction: { type: "object" },
    retrieval: { type: "object" },
    semantic: { type: "object" },
  },
};

export const CANONICAL_SCHEMA_ENTRIES = [
  ["checkpoint-v2.schema.json", checkpointV2Schema],
  ["directive-record.schema.json", directiveRecordSchema],
  ["evidence-receipt.schema.json", evidenceReceiptSchema],
  ["runtime-config.schema.json", runtimeConfigSchema],
  ["runtime-cursor.schema.json", runtimeCursorSchema],
  ["source-class.schema.json", sourceClassSchema],
  ["user-turn-record.schema.json", userTurnRecordSchema],
];
