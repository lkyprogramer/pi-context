import type { RuntimeCursor, SemanticProposal } from "@pcr/contracts";

import type { SemanticProvider } from "./port.js";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface SemanticProposalInput {
  operationId: string;
  cursor: RuntimeCursor;
}

export interface SemanticEvidencePointer {
  ref: string;
  kind?: string;
}

export interface SemanticEvidenceCatalog {
  pointers(cursor: RuntimeCursor, signal?: AbortSignal): Promise<readonly SemanticEvidencePointer[]>;
}

export interface SemanticProposer {
  propose(input: SemanticProposalInput, signal: AbortSignal): Promise<SemanticProposal>;
}

export interface CreateSemanticProposerInput {
  cursor: RuntimeCursor;
  evidence: SemanticEvidenceCatalog;
  provider: Pick<SemanticProvider, "propose">;
}

export type SemanticProposerErrorCode =
  | "PCR_PROPOSER_DEPENDENCY_MISSING"
  | "PCR_PROPOSER_INPUT_INVALID"
  | "PCR_PROPOSER_SCOPE_MISMATCH";

export class SemanticProposerError extends TypeError {
  readonly code: SemanticProposerErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: SemanticProposerErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "SemanticProposerError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new SemanticProposerError("PCR_PROPOSER_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new SemanticProposerError("PCR_PROPOSER_INPUT_INVALID", { field });
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

function parseCatalogRefs(pointers: unknown): string[] {
  if (!Array.isArray(pointers)) failInput("evidence.pointers");
  const refs: string[] = [];
  for (const [index, item] of pointers.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) failInput(`evidence.pointers[${index}]`);
    const ref = (item as { ref?: unknown }).ref;
    requireNonEmpty(ref, `evidence.pointers[${index}].ref`);
    if (!refs.includes(ref)) refs.push(ref);
  }
  if (refs.length === 0) failInput("evidence.pointers");
  return refs;
}

function mapProviderError(error: unknown): never {
  if (error && typeof error === "object" && "name" in error && error.name === "AbortError") throw error;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    if (error.code.endsWith("SCOPE_MISMATCH")) {
      throw new SemanticProposerError("PCR_PROPOSER_SCOPE_MISMATCH");
    }
    if (error.code.endsWith("INPUT_INVALID")) {
      throw new SemanticProposerError("PCR_PROPOSER_INPUT_INVALID", { field: error.code });
    }
  }
  throw error;
}

export function createSemanticProposer(input: CreateSemanticProposerInput): SemanticProposer {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.evidence || typeof input.evidence !== "object") failMissing("evidence");
  requireFunction(input.evidence.pointers, "evidence.pointers");
  if (!input.provider || typeof input.provider !== "object") failMissing("provider");
  requireFunction(input.provider.propose, "provider.propose");
  const bound = snapshotCursor(input.cursor, "input.cursor");
  const evidence = input.evidence;
  const provider = input.provider;

  return {
    async propose(request: SemanticProposalInput, signal: AbortSignal): Promise<SemanticProposal> {
      if (!request || typeof request !== "object") failInput("request");
      requireNonEmpty(request.operationId, "request.operationId");
      if (!(signal instanceof AbortSignal)) failInput("signal");
      signal.throwIfAborted();
      const cursor = snapshotCursor(request.cursor, "request.cursor");
      if (!sameCursor(bound, cursor)) throw new SemanticProposerError("PCR_PROPOSER_SCOPE_MISMATCH");
      signal.throwIfAborted();
      const pointers = await evidence.pointers(cursor, signal);
      const sourceRefs = parseCatalogRefs(pointers);
      signal.throwIfAborted();
      let proposal: SemanticProposal;
      try {
        proposal = await provider.propose({
          operationId: request.operationId,
          cursor,
          sourceRefs,
          signal,
        });
      } catch (error) {
        mapProviderError(error);
      }
      signal.throwIfAborted();
      if (!proposal || typeof proposal !== "object") failInput("proposal");
      if (!Array.isArray(proposal.claims) || proposal.claims.length === 0) failInput("proposal.claims");
      const allowed = new Set(sourceRefs);
      for (const claim of proposal.claims) {
        if (!claim || !Array.isArray(claim.sourceRefs) || claim.sourceRefs.length === 0) {
          failInput("proposal.claims.sourceRefs");
        }
        for (const ref of claim.sourceRefs) {
          if (!allowed.has(ref)) failInput("proposal.claims.sourceRefs");
        }
      }
      return proposal;
    },
  };
}
