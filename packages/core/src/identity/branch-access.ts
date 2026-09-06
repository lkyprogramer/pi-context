export interface SessionIdentity {
  workspaceId: string;
  sessionId: string;
}

export interface EntryLink {
  id: string;
  parentId: string | null;
}

export interface BranchView extends SessionIdentity {
  headId: string;
  ancestorIds: ReadonlySet<string>;
  parentSessionId?: string;
  inheritedEntryIds?: ReadonlySet<string>;
}

export interface SourceLocation extends SessionIdentity {
  entryId: string;
}

export interface ForkInheritanceProof {
  parentSessionId: string;
  parentSessionPath: string;
  parentEntryIds: ReadonlySet<string>;
  claimedParentSessionPath: string | undefined;
}

export const SOURCE_ENTRY_REF_PREFIX = "pcr-entry:";
export const SOURCE_CALL_REF_PREFIX = "pcr-call:";

export type BranchAccessErrorCode =
  | "PCR_BRANCH_CYCLE"
  | "PCR_BRANCH_MISSING_PARENT"
  | "PCR_BRANCH_DUPLICATE_ID"
  | "PCR_BRANCH_HEAD_UNKNOWN"
  | "PCR_BRANCH_IDENTITY_INVALID"
  | "PCR_BRANCH_FORK_UNPROVEN";

export class BranchAccessError extends TypeError {
  readonly code: BranchAccessErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: BranchAccessErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "BranchAccessError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function requireIdentity(identity: SessionIdentity, field: string): SessionIdentity {
  if (!identity || typeof identity !== "object") {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field });
  }
  if (typeof identity.workspaceId !== "string" || identity.workspaceId.length === 0) {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: `${field}.workspaceId` });
  }
  if (typeof identity.sessionId !== "string" || identity.sessionId.length === 0) {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: `${field}.sessionId` });
  }
  return { workspaceId: identity.workspaceId, sessionId: identity.sessionId };
}

function requireEntryId(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field });
  }
  return value;
}

export function sessionIdentityKey(identity: SessionIdentity): string {
  const bound = requireIdentity(identity, "identity");
  return JSON.stringify([bound.workspaceId, bound.sessionId]);
}

export function sameSessionIdentity(left: SessionIdentity, right: SessionIdentity): boolean {
  return left.workspaceId === right.workspaceId && left.sessionId === right.sessionId;
}

export function sourceEntryRef(entryId: string): string {
  return `${SOURCE_ENTRY_REF_PREFIX}${requireEntryId(entryId, "entryId")}`;
}

export function sourceCallRef(toolCallId: string): string {
  return `${SOURCE_CALL_REF_PREFIX}${requireEntryId(toolCallId, "toolCallId")}`;
}

export function parsePrefixedRef(sourceRefs: readonly string[], prefix: string): string | undefined {
  if (!Array.isArray(sourceRefs)) return undefined;
  for (const ref of sourceRefs) {
    if (typeof ref === "string" && ref.startsWith(prefix) && ref.length > prefix.length) {
      return ref.slice(prefix.length);
    }
  }
  return undefined;
}

export function parseSourceEntryId(sourceRefs: readonly string[]): string | undefined {
  return parsePrefixedRef(sourceRefs, SOURCE_ENTRY_REF_PREFIX);
}

export function parseSourceCallId(sourceRefs: readonly string[]): string | undefined {
  return parsePrefixedRef(sourceRefs, SOURCE_CALL_REF_PREFIX);
}

export function buildBranchView(
  identity: SessionIdentity,
  entries: readonly EntryLink[],
  headId: string,
): BranchView {
  const bound = requireIdentity(identity, "identity");
  const head = requireEntryId(headId, "headId");
  if (!Array.isArray(entries)) {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: "entries" });
  }
  const byId = new Map<string, EntryLink>();
  for (const [index, entry] of entries.entries()) {
    if (!entry || typeof entry !== "object") {
      throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: `entries[${index}]` });
    }
    const id = requireEntryId(entry.id, `entries[${index}].id`);
    if (entry.parentId !== null && (typeof entry.parentId !== "string" || entry.parentId.length === 0)) {
      throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: `entries[${index}].parentId` });
    }
    const existing = byId.get(id);
    if (existing) {
      throw new BranchAccessError("PCR_BRANCH_DUPLICATE_ID", { entryId: id });
    }
    byId.set(id, { id, parentId: entry.parentId });
  }
  if (!byId.has(head)) {
    throw new BranchAccessError("PCR_BRANCH_HEAD_UNKNOWN", { headId: head });
  }
  const ancestorIds = new Set<string>();
  let current: string | null = head;
  while (current !== null) {
    if (ancestorIds.has(current)) {
      throw new BranchAccessError("PCR_BRANCH_CYCLE", { entryId: current });
    }
    const node = byId.get(current);
    if (!node) {
      throw new BranchAccessError("PCR_BRANCH_MISSING_PARENT", { entryId: current });
    }
    ancestorIds.add(current);
    if (node.parentId === null) break;
    if (!byId.has(node.parentId)) {
      throw new BranchAccessError("PCR_BRANCH_MISSING_PARENT", { entryId: node.parentId });
    }
    current = node.parentId;
  }
  return {
    workspaceId: bound.workspaceId,
    sessionId: bound.sessionId,
    headId: head,
    ancestorIds,
  };
}

export function attachForkInheritance(view: BranchView, proof: ForkInheritanceProof): BranchView {
  if (!view || typeof view !== "object") {
    throw new BranchAccessError("PCR_BRANCH_IDENTITY_INVALID", { field: "view" });
  }
  if (!proof || typeof proof !== "object") {
    throw new BranchAccessError("PCR_BRANCH_FORK_UNPROVEN", { field: "proof" });
  }
  if (typeof proof.parentSessionId !== "string" || proof.parentSessionId.length === 0) {
    throw new BranchAccessError("PCR_BRANCH_FORK_UNPROVEN", { field: "parentSessionId" });
  }
  if (typeof proof.parentSessionPath !== "string" || proof.parentSessionPath.length === 0) {
    throw new BranchAccessError("PCR_BRANCH_FORK_UNPROVEN", { field: "parentSessionPath" });
  }
  if (proof.claimedParentSessionPath !== proof.parentSessionPath) {
    throw new BranchAccessError("PCR_BRANCH_FORK_UNPROVEN", { field: "claimedParentSessionPath" });
  }
  if (proof.parentSessionId === view.sessionId) {
    throw new BranchAccessError("PCR_BRANCH_FORK_UNPROVEN", { field: "parentSessionId" });
  }
  const inherited = new Set<string>();
  for (const entryId of view.ancestorIds) {
    if (proof.parentEntryIds.has(entryId)) inherited.add(entryId);
  }
  return {
    ...view,
    parentSessionId: proof.parentSessionId,
    inheritedEntryIds: inherited,
  };
}

export function canReadSource(view: BranchView, source: SourceLocation): boolean {
  if (!view || typeof view !== "object" || !source || typeof source !== "object") return false;
  if (typeof source.entryId !== "string" || source.entryId.length === 0) return false;
  if (source.workspaceId !== view.workspaceId) return false;
  if (!view.ancestorIds.has(source.entryId)) return false;
  if (source.sessionId === view.sessionId) return true;
  return (
    typeof view.parentSessionId === "string"
    && view.parentSessionId.length > 0
    && source.sessionId === view.parentSessionId
    && view.inheritedEntryIds instanceof Set
    && view.inheritedEntryIds.has(source.entryId)
  );
}
