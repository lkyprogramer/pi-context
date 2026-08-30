import { domainHash, isPcrError, type RuntimeCursor, type SemanticProposal, type ProposedClaim } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface SemanticVerifierIssue {
  code: "UNCITED_CLAIM" | "POLARITY_REWRITE";
  field: string;
  claimId?: string;
}

export interface SemanticVerification {
  ok: boolean;
  issues: SemanticVerifierIssue[];
  patched: SemanticProposal;
}

export interface SemanticDirectiveFact {
  polarity: string;
  status: string;
  key?: string;
}

export interface SemanticRuntimeSnapshot {
  cursor: RuntimeCursor;
  sourceRefs: readonly string[];
  directives: readonly SemanticDirectiveFact[];
  signal?: AbortSignal;
}

export interface SemanticVerifier {
  verify(proposal: SemanticProposal, snapshot: SemanticRuntimeSnapshot): Promise<SemanticVerification>;
}

export interface CreateSemanticVerifierInput {
  cursor: RuntimeCursor;
}

export type SemanticVerifierErrorCode =
  | "PCR_VERIFIER_DEPENDENCY_MISSING"
  | "PCR_VERIFIER_INPUT_INVALID"
  | "PCR_VERIFIER_SCOPE_MISMATCH";

export class SemanticVerifierError extends TypeError {
  readonly code: SemanticVerifierErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SemanticVerifierErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SemanticVerifierError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new SemanticVerifierError("PCR_VERIFIER_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new SemanticVerifierError("PCR_VERIFIER_INPUT_INVALID", { field });
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
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

function parseClaim(value: unknown, index: number): ProposedClaim {
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput(`proposal.claims[${index}]`);
  const row = value as Record<string, unknown>;
  requireNonEmpty(row.claimId, `proposal.claims[${index}].claimId`);
  requireNonEmpty(row.key, `proposal.claims[${index}].key`);
  requireNonEmpty(row.polarity, `proposal.claims[${index}].polarity`);
  requireNonEmpty(row.status, `proposal.claims[${index}].status`);
  if (row.value === undefined) failInput(`proposal.claims[${index}].value`);
  const sourceRefs = parseSourceRefs(row.sourceRefs, `proposal.claims[${index}].sourceRefs`);
  if (sourceRefs.length === 0) failInput(`proposal.claims[${index}].sourceRefs`);
  return {
    claimId: row.claimId,
    key: row.key,
    polarity: row.polarity,
    status: row.status,
    value: row.value,
    sourceRefs,
  };
}

function parseProposal(value: unknown): SemanticProposal {
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput("proposal");
  const row = value as Record<string, unknown>;
  requireNonEmpty(row.proposalId, "proposal.proposalId");
  if (!SHA256_PATTERN.test(row.proposalId)) failInput("proposal.proposalId");
  const claimsRaw = row.claims;
  if (!Array.isArray(claimsRaw) || claimsRaw.length === 0) failInput("proposal.claims");
  const claims = claimsRaw.map((item, index) => parseClaim(item, index));
  const sourceRefs = parseSourceRefs(row.sourceRefs ?? claims.flatMap((item) => item.sourceRefs), "proposal.sourceRefs");
  return {
    proposalId: row.proposalId,
    sourceRefs,
    claims,
    continuityPatch: row.continuityPatch === undefined ? null : row.continuityPatch,
  };
}

function parseDirectives(value: unknown): SemanticDirectiveFact[] {
  if (!Array.isArray(value)) failInput("snapshot.directives");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) failInput(`snapshot.directives[${index}]`);
    const row = item as Record<string, unknown>;
    requireNonEmpty(row.polarity, `snapshot.directives[${index}].polarity`);
    requireNonEmpty(row.status, `snapshot.directives[${index}].status`);
    if (row.key !== undefined) requireNonEmpty(row.key, `snapshot.directives[${index}].key`);
    return { polarity: row.polarity, status: row.status, key: typeof row.key === "string" ? row.key : undefined };
  });
}

function proposalIdFor(cursor: RuntimeCursor, proposal: Omit<SemanticProposal, "proposalId">): string {
  try {
    return domainHash("semantic-proposal", {
      cursor,
      sourceRefs: proposal.sourceRefs,
      claims: proposal.claims,
      continuityPatch: proposal.continuityPatch,
    });
  } catch (error) {
    if (isPcrError(error)) failInput("proposal");
    throw error;
  }
}

export function createSemanticVerifier(input: CreateSemanticVerifierInput): SemanticVerifier {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  const bound = snapshotCursor(input.cursor, "input.cursor");

  return {
    async verify(rawProposal: SemanticProposal, rawSnapshot: SemanticRuntimeSnapshot): Promise<SemanticVerification> {
      if (!rawSnapshot || typeof rawSnapshot !== "object") failInput("snapshot");
      if (rawSnapshot.signal !== undefined && !(rawSnapshot.signal instanceof AbortSignal)) {
        failInput("snapshot.signal");
      }
      rawSnapshot.signal?.throwIfAborted();
      const snapshotCursorValue = snapshotCursor(rawSnapshot.cursor, "snapshot.cursor");
      if (!sameCursor(bound, snapshotCursorValue)) {
        throw new SemanticVerifierError("PCR_VERIFIER_SCOPE_MISMATCH");
      }
      const allowed = new Set(parseSourceRefs(rawSnapshot.sourceRefs, "snapshot.sourceRefs"));
      if (allowed.size === 0) failInput("snapshot.sourceRefs");
      const directives = parseDirectives(rawSnapshot.directives);
      rawSnapshot.signal?.throwIfAborted();
      const proposal = parseProposal(rawProposal);
      const issues: SemanticVerifierIssue[] = [];
      const cited: ProposedClaim[] = [];
      for (const claim of proposal.claims) {
        const uncited = claim.sourceRefs.some((ref) => !allowed.has(ref));
        if (uncited) {
          issues.push({ code: "UNCITED_CLAIM", field: "claims.sourceRefs", claimId: claim.claimId });
          continue;
        }
        const live = directives.find((item) => item.key === claim.key && item.status === "active");
        if (live && live.polarity !== "must-not" && claim.polarity === "must-not") {
          issues.push({ code: "POLARITY_REWRITE", field: "claims.polarity", claimId: claim.claimId });
          cited.push(claim);
          continue;
        }
        cited.push(claim);
      }
      const terminal = issues.some((item) => item.code === "POLARITY_REWRITE");
      const kept = terminal ? proposal.claims.map((claim) => ({ ...claim, sourceRefs: [...claim.sourceRefs] })) : cited;
      if (kept.length === 0) failInput("proposal.claims");
      const sourceRefs: string[] = [];
      for (const claim of kept) {
        for (const ref of claim.sourceRefs) {
          if (!sourceRefs.includes(ref)) sourceRefs.push(ref);
        }
      }
      const patchedBody = {
        sourceRefs,
        claims: kept.map((claim) => ({ ...claim, sourceRefs: [...claim.sourceRefs] })),
        continuityPatch: proposal.continuityPatch,
      };
      return {
        ok: !terminal && cited.length > 0,
        issues,
        patched: {
          proposalId: proposalIdFor(snapshotCursorValue, patchedBody),
          ...patchedBody,
        },
      };
    },
  };
}
