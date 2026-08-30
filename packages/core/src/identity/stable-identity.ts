import { domainHash, type RuntimeCursor, type RuntimeCursorInput, type StableIdentityInput } from "@pcr/contracts";

const HASH_PATTERN = /^[0-9a-f]{64}$/u;
const IDENTITY_FIELDS = new Set(["cursor", "sourceEntryId", "contentHash", "toolCallId"]);

function requireNonEmpty(label: string, value: unknown): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function normalizeWorkspacePath(value: string): string {
  requireNonEmpty("workspacePath", value);
  const normalized = value.replaceAll("\\", "/").replace(/\/{2,}/gu, "/").replace(/\/$/u, "") || "/";
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//u.test(normalized)) {
    throw new TypeError("workspacePath must be absolute");
  }
  return normalized;
}

function validateCursor(cursor: RuntimeCursor): void {
  if (!cursor || typeof cursor !== "object") throw new TypeError("cursor is required");
  requireNonEmpty("cursor.workspaceId", cursor.workspaceId);
  requireNonEmpty("cursor.sessionId", cursor.sessionId);
  if (cursor.leafId !== null) requireNonEmpty("cursor.leafId", cursor.leafId);
  if (typeof cursor.lineageHash !== "string" || !HASH_PATTERN.test(cursor.lineageHash)) {
    throw new TypeError("cursor.lineageHash must be a SHA-256 digest");
  }
  requireNonEmpty("cursor.modelKey", cursor.modelKey);
}

function validateIdentityInput(input: StableIdentityInput): void {
  if (!input || typeof input !== "object") throw new TypeError("identity input is required");
  for (const field of Object.keys(input)) {
    if (!IDENTITY_FIELDS.has(field)) throw new TypeError(`unknown identity field: ${field}`);
  }
  validateCursor(input.cursor);
  requireNonEmpty("sourceEntryId", input.sourceEntryId);
  if (typeof input.contentHash !== "string" || !HASH_PATTERN.test(input.contentHash)) {
    throw new TypeError("contentHash must be a SHA-256 digest");
  }
  if (input.toolCallId !== undefined) requireNonEmpty("toolCallId", input.toolCallId);
}

function stableIdentity(domain: "host" | "evidence" | "directive", input: StableIdentityInput): string {
  validateIdentityInput(input);
  return `${domain}_${domainHash(`identity-${domain}`, {
    contentHash: input.contentHash,
    cursor: input.cursor,
    sourceEntryId: input.sourceEntryId,
    toolCallId: input.toolCallId ?? null,
  })}`;
}

export function createRuntimeCursor(input: RuntimeCursorInput): RuntimeCursor {
  if (!input || typeof input !== "object") throw new TypeError("runtime cursor input is required");
  const workspacePath = normalizeWorkspacePath(input.workspacePath);
  requireNonEmpty("sessionId", input.sessionId);
  if (input.leafId !== null) requireNonEmpty("leafId", input.leafId);
  requireNonEmpty("modelKey", input.modelKey);
  if (!Array.isArray(input.lineageEntryIds) || input.lineageEntryIds.length === 0) {
    throw new TypeError("lineageEntryIds must contain at least one host entry id");
  }
  for (const entryId of input.lineageEntryIds) requireNonEmpty("lineageEntryIds[]", entryId);

  return {
    workspaceId: `ws_${domainHash("workspace", { path: workspacePath }).slice(0, 40)}`,
    sessionId: input.sessionId,
    leafId: input.leafId,
    lineageHash: domainHash("lineage", {
      entries: input.lineageEntryIds,
      leafId: input.leafId,
      sessionId: input.sessionId,
    }),
    modelKey: input.modelKey,
  };
}

export const stableHostMessageId = (input: StableIdentityInput): string => stableIdentity("host", input);
export const stableEvidenceId = (input: StableIdentityInput): string => stableIdentity("evidence", input);
export const stableDirectiveId = (input: StableIdentityInput): string => stableIdentity("directive", input);
