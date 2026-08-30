import {
  actionAuthorityRank,
  sourceAuthorityCeiling,
  type ActionAuthority,
  type RuntimeCursor,
  type SourceClass,
} from "@pcr/contracts";

import {
  AuthorizationError,
  TOOL_ORIGINS,
  type ActionAuthorizationDecision,
  type ActionAuthorizationInput,
  type AuthorizationService,
  type CreateAuthorizationMachineInput,
  type ToolOrigin,
  type ToolTrustPolicy,
} from "./types.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ORIGINS = new Set<string>(TOOL_ORIGINS);
const AUTHORITIES = new Set<ActionAuthority>(["none", "inform", "propose", "act"]);

function failMissing(dependency: string): never {
  throw new AuthorizationError("PCR_AUTHORIZATION_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new AuthorizationError("PCR_AUTHORIZATION_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

export function snapshotAuthorizationCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

export function snapshotToolTrustPolicy(value: ToolTrustPolicy, field = "policy"): ToolTrustPolicy {
  if (!value || typeof value !== "object") failMissing(field);
  if (!Array.isArray(value.allowlistedToolNames)) failMissing(`${field}.allowlistedToolNames`);
  const allowlistedToolNames = value.allowlistedToolNames.map((name, index) => {
    requireNonEmpty(name, `${field}.allowlistedToolNames[${index}]`);
    return name;
  });
  return Object.freeze({ allowlistedToolNames: Object.freeze([...allowlistedToolNames]) });
}

function classifySource(
  toolName: string,
  origin: ToolOrigin,
  verifiedReceipt: boolean,
  policy: ToolTrustPolicy,
): SourceClass {
  if (origin !== "builtin") return "untrusted-tool";
  if (policy.allowlistedToolNames.includes(toolName) && verifiedReceipt) return "trusted-tool";
  return "untrusted-tool";
}

export function authorizeAction(input: ActionAuthorizationInput): ActionAuthorizationDecision {
  if (!input || typeof input !== "object") failInput("input");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("input.signal");
  input.signal?.throwIfAborted();
  snapshotAuthorizationCursor(input.cursor, "input.cursor");
  requireNonEmpty(input.toolName, "input.toolName");
  if (typeof input.origin !== "string" || !ORIGINS.has(input.origin)) failInput("input.origin");
  if (typeof input.requestedAuthority !== "string" || !AUTHORITIES.has(input.requestedAuthority)) {
    failInput("input.requestedAuthority");
  }
  if (input.verifiedReceipt !== undefined && typeof input.verifiedReceipt !== "boolean") {
    failInput("input.verifiedReceipt");
  }
  const policy = snapshotToolTrustPolicy(input.policy, "input.policy");
  input.signal?.throwIfAborted();
  const verifiedReceipt = input.verifiedReceipt === true;
  const sourceClass = classifySource(input.toolName, input.origin, verifiedReceipt, policy);
  const ceiling = sourceAuthorityCeiling(sourceClass);
  if (actionAuthorityRank(input.requestedAuthority) > actionAuthorityRank(ceiling)) {
    return Object.freeze({
      kind: "deny",
      code: "PCR_ACTION_AUTHORITY_MISSING",
      sourceClass,
      authority: ceiling,
      ceiling,
      toolName: input.toolName,
      origin: input.origin,
      reason: "requested-authority-exceeds-source-ceiling",
    });
  }
  return Object.freeze({
    kind: "allow",
    sourceClass,
    authority: input.requestedAuthority,
    ceiling,
    toolName: input.toolName,
    origin: input.origin,
    reason: sourceClass === "trusted-tool" ? "allowlisted-verified-receipt" : "within-untrusted-ceiling",
  });
}

export function createAuthorizationMachine(input: CreateAuthorizationMachineInput): AuthorizationService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.policy || typeof input.policy !== "object") failMissing("policy");
  const bound = snapshotAuthorizationCursor(input.cursor, "input.cursor");
  const policy = snapshotToolTrustPolicy(input.policy, "input.policy");
  return {
    authorize(event: Omit<ActionAuthorizationInput, "policy">): ActionAuthorizationDecision {
      if (!event || typeof event !== "object") failInput("event");
      if (event.signal !== undefined && !(event.signal instanceof AbortSignal)) failInput("event.signal");
      event.signal?.throwIfAborted();
      const cursor = snapshotAuthorizationCursor(event.cursor, "event.cursor");
      if (!sameCursor(bound, cursor)) {
        throw new AuthorizationError("PCR_AUTHORIZATION_SCOPE_MISMATCH");
      }
      event.signal?.throwIfAborted();
      return authorizeAction({ ...event, cursor, policy, signal: event.signal });
    },
  };
}
