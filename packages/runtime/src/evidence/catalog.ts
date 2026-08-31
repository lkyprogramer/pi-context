import { domainHash, type RuntimeCursor } from "@pcr/contracts";

const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export interface EvidencePointer {
  ref: string;
  kind: string;
  sourceSpan: { first: string; last: string };
  status: "active" | "retired";
  authority: string;
  expiresAt: number | null;
}

export interface EvidenceCatalog {
  admit(input: {
    cursor: RuntimeCursor;
    ref: string;
    kind: string;
    sourceId: string;
    authority: string;
    now: number;
    ttlMs?: number;
    signal?: AbortSignal;
  }): Promise<EvidencePointer>;
  list(cursor: RuntimeCursor, sourceSpan?: { first: string; last: string }): Promise<EvidencePointer[]>;
  retire(cursor: RuntimeCursor, ref: string): Promise<void>;
  select(cursor: RuntimeCursor, sourceSpan: { first: string; last: string }): Promise<EvidencePointer[]>;
}

export type EvidenceCatalogErrorCode =
  | "PCR_EVIDENCE_CATALOG_DEPENDENCY_MISSING"
  | "PCR_EVIDENCE_CATALOG_INPUT_INVALID"
  | "PCR_EVIDENCE_CATALOG_SCOPE_MISMATCH";

export class EvidenceCatalogError extends TypeError {
  readonly code: EvidenceCatalogErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: EvidenceCatalogErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "EvidenceCatalogError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new EvidenceCatalogError("PCR_EVIDENCE_CATALOG_INPUT_INVALID", { field });
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): RuntimeCursor {
  if (!value || typeof value !== "object") failInput(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  if (typeof cursor.sessionId !== "string" || cursor.sessionId.length === 0 || cursor.sessionId === "unbound") {
    failInput(`${field}.sessionId`);
  }
  if (cursor.leafId !== null && (typeof cursor.leafId !== "string" || cursor.leafId.length === 0)) failInput(`${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  if (typeof cursor.modelKey !== "string" || cursor.modelKey.length === 0) failInput(`${field}.modelKey`);
  return Object.freeze(cursor);
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function cursorKey(cursor: RuntimeCursor): string {
  return JSON.stringify([cursor.workspaceId, cursor.sessionId, cursor.leafId, cursor.lineageHash, cursor.modelKey]);
}

export function createEvidenceCatalog(): EvidenceCatalog {
  const rows = new Map<string, EvidencePointer[]>();
  return {
    async admit(input) {
      if (!input || typeof input !== "object") failInput("input");
      input.signal?.throwIfAborted();
      const cursor = snapshotCursor(input.cursor);
      if (typeof input.ref !== "string" || input.ref.length === 0) failInput("ref");
      if (typeof input.kind !== "string" || input.kind.length === 0) failInput("kind");
      if (typeof input.sourceId !== "string" || input.sourceId.length === 0) failInput("sourceId");
      const pointer: EvidencePointer = {
        ref: input.ref,
        kind: input.kind,
        sourceSpan: { first: input.sourceId, last: input.sourceId },
        status: "active",
        authority: input.authority,
        expiresAt: typeof input.ttlMs === "number" ? input.now + input.ttlMs : null,
      };
      const key = cursorKey(cursor);
      const list = rows.get(key) ?? [];
      list.push(pointer);
      rows.set(key, list);
      return Object.freeze({ ...pointer, shortRef: domainHash("pointer-ref", pointer.ref).slice(0, 12) }) as EvidencePointer;
    },
    async list(cursorInput, sourceSpan) {
      const cursor = snapshotCursor(cursorInput);
      const list = rows.get(cursorKey(cursor)) ?? [];
      if (!sourceSpan) return list.filter((item) => item.status === "active");
      return list.filter((item) => (
        item.status === "active"
        && item.sourceSpan.first >= sourceSpan.first
        && item.sourceSpan.last <= sourceSpan.last
      ));
    },
    async retire(cursorInput, ref) {
      const cursor = snapshotCursor(cursorInput);
      const list = rows.get(cursorKey(cursor)) ?? [];
      for (const item of list) {
        if (item.ref === ref) item.status = "retired";
      }
    },
    async select(cursorInput, sourceSpan) {
      const cursor = snapshotCursor(cursorInput);
      return (rows.get(cursorKey(cursor)) ?? []).filter((item) => (
        item.status === "active"
        && item.sourceSpan.first === sourceSpan.first
        && item.sourceSpan.last === sourceSpan.last
      ));
    },
  };
}

export function assertCatalogCursor(expected: RuntimeCursor, actual: RuntimeCursor): void {
  if (!sameCursor(expected, actual)) {
    throw new EvidenceCatalogError("PCR_EVIDENCE_CATALOG_SCOPE_MISMATCH");
  }
}
