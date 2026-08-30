import { domainHash, type RuntimeCursor, type ProposedClaim, type SemanticProposal } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const HIDDEN_KEYS = new Set(["hiddenReasoning", "reasoning", "chainOfThought"]);
const ROOT_KEYS = new Set(["claims", "continuityPatch"]);

export interface SemanticProposeRequest {
  operationId: string;
  cursor: RuntimeCursor;
  sourceRefs: string[];
  signal?: AbortSignal;
}

export interface SemanticProvider {
  propose(input: SemanticProposeRequest): Promise<SemanticProposal>;
}

export interface CreateSemanticProviderInput {
  cursor: RuntimeCursor;
  generate(input: SemanticProposeRequest): Promise<unknown>;
}

export type SemanticProviderErrorCode =
  | "PCR_SEMANTIC_DEPENDENCY_MISSING"
  | "PCR_SEMANTIC_INPUT_INVALID"
  | "PCR_SEMANTIC_SCOPE_MISMATCH";

export class SemanticProviderError extends TypeError {
  readonly code: SemanticProviderErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SemanticProviderErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SemanticProviderError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new SemanticProviderError("PCR_SEMANTIC_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new SemanticProviderError("PCR_SEMANTIC_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFunction(value: unknown, dependency: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") failMissing(dependency);
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): Readonly<RuntimeCursor> {
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

function parseSourceRefs(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) failInput(field);
  const refs: string[] = [];
  for (const [index, item] of value.entries()) {
    requireNonEmpty(item, `${field}[${index}]`);
    if (!refs.includes(item)) refs.push(item);
  }
  return refs;
}

function parseClaim(value: unknown, index: number, allowed: ReadonlySet<string>): ProposedClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput(`claims[${index}]`);
  const row = value as Record<string, unknown>;
  requireNonEmpty(row.claimId, `claims[${index}].claimId`);
  requireNonEmpty(row.key, `claims[${index}].key`);
  requireNonEmpty(row.polarity, `claims[${index}].polarity`);
  requireNonEmpty(row.status, `claims[${index}].status`);
  const sourceRefs = parseSourceRefs(row.sourceRefs, `claims[${index}].sourceRefs`);
  if (sourceRefs.length === 0) failInput(`claims[${index}].sourceRefs`);
  for (const ref of sourceRefs) {
    if (!allowed.has(ref)) failInput(`claims[${index}].sourceRefs`);
  }
  return {
    claimId: row.claimId,
    key: row.key,
    polarity: row.polarity,
    status: row.status,
    value: row.value,
    sourceRefs: [...sourceRefs],
  };
}

function parseProposal(raw: unknown, allowed: readonly string[]): Omit<SemanticProposal, "proposalId"> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) failInput("generate");
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (HIDDEN_KEYS.has(key)) failInput(key);
    if (!ROOT_KEYS.has(key)) failInput(key);
  }
  const rawClaims = record.claims === undefined ? [] : record.claims;
  if (!Array.isArray(rawClaims)) failInput("claims");
  const allow = new Set(allowed);
  const claims = rawClaims.map((item, index) => parseClaim(item, index, allow));
  const sourceRefs: string[] = [];
  for (const claim of claims) {
    for (const ref of claim.sourceRefs) {
      if (!sourceRefs.includes(ref)) sourceRefs.push(ref);
    }
  }
  return {
    sourceRefs: [...sourceRefs],
    claims: claims.map((claim) => ({ ...claim, sourceRefs: [...claim.sourceRefs] })),
    continuityPatch: record.continuityPatch === undefined ? null : record.continuityPatch,
  };
}

export function createSemanticProvider(input: CreateSemanticProviderInput): SemanticProvider {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  requireFunction(input.generate, "generate");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const generate = input.generate;

  return {
    async propose(request: SemanticProposeRequest): Promise<SemanticProposal> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.operationId, "request.operationId");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("request.signal");
      const sourceRefs = parseSourceRefs(request.sourceRefs, "request.sourceRefs");
      request.signal?.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) throw new SemanticProviderError("PCR_SEMANTIC_SCOPE_MISMATCH");
      request.signal?.throwIfAborted();
      const raw = await generate({
        operationId: request.operationId,
        cursor,
        sourceRefs,
        signal: request.signal,
      });
      request.signal?.throwIfAborted();
      const parsed = parseProposal(raw, sourceRefs);
      return {
        proposalId: domainHash("semantic-proposal", {
          cursor,
          sourceRefs: parsed.sourceRefs,
          claims: parsed.claims,
          continuityPatch: parsed.continuityPatch,
        }),
        sourceRefs: parsed.sourceRefs,
        claims: parsed.claims,
        continuityPatch: parsed.continuityPatch,
      };
    },
  };
}

export type { ProposedClaim, SemanticProposal };
