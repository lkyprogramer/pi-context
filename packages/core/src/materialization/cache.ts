import { domainHash, type RuntimeCursor } from "@pcr/contracts";

import { BudgetError, snapshotBudgetCursor } from "../budget/pricer.js";
import { SECTION_ZONE, type SectionKind, type SectionPlan } from "./sections.js";

export interface CacheReceipt {
  viewId: string;
  cursor: RuntimeCursor;
  sections: Array<{ kind: SectionKind; zone: SectionPlan["zone"]; contentHash: string; tokenCost: number }>;
  firstDifferentSection: SectionKind | null;
  eligiblePrefixTokens: number;
  previousViewId: string | null;
}

export type CacheReceiptRecord = CacheReceipt;

export interface CacheReceiptStore {
  put(receipt: CacheReceiptRecord): Promise<void>;
  head(cursor: RuntimeCursor): Promise<CacheReceiptRecord | null>;
}

export interface CommitCacheInput {
  cursor: RuntimeCursor;
  sections: readonly SectionPlan[];
  signal?: AbortSignal;
}

export interface CacheReceiptService {
  commit(input: CommitCacheInput): Promise<CacheReceipt>;
  current(cursor: RuntimeCursor, signal?: AbortSignal): Promise<CacheReceipt | null>;
}

export interface CreateCacheReceiptInput {
  cursor: RuntimeCursor;
  store: CacheReceiptStore;
}

export type CacheErrorCode =
  | "PCR_CACHE_DEPENDENCY_MISSING"
  | "PCR_CACHE_INPUT_INVALID"
  | "PCR_CACHE_SCOPE_MISMATCH";

export class CacheError extends TypeError {
  readonly code: CacheErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: CacheErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "CacheError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failMissing(dependency: string): never {
  throw new CacheError("PCR_CACHE_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new CacheError("PCR_CACHE_INPUT_INVALID", { field });
}

function sameCursor(left: RuntimeCursor, right: RuntimeCursor): boolean {
  return left.workspaceId === right.workspaceId
    && left.sessionId === right.sessionId
    && left.leafId === right.leafId
    && left.lineageHash === right.lineageHash
    && left.modelKey === right.modelKey;
}

function snapshotPlans(sections: readonly SectionPlan[], field: string): SectionPlan[] {
  if (!Array.isArray(sections) || sections.length === 0) failInput(field);
  return sections.map((section, index) => {
    if (!section || typeof section !== "object") failInput(`${field}[${index}]`);
    if (typeof section.kind !== "string" || !(section.kind in SECTION_ZONE)) failInput(`${field}[${index}].kind`);
    if (typeof section.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(section.contentHash)) {
      failInput(`${field}[${index}].contentHash`);
    }
    if (typeof section.tokenCost !== "number" || !Number.isFinite(section.tokenCost) || section.tokenCost < 0) {
      failInput(`${field}[${index}].tokenCost`);
    }
    return section;
  });
}

function firstDifferent(previous: CacheReceiptRecord | null, sections: readonly SectionPlan[]): SectionKind | null {
  if (!previous) return sections[0]?.kind ?? null;
  const max = Math.max(previous.sections.length, sections.length);
  for (let index = 0; index < max; index += 1) {
    const last = previous.sections[index];
    const next = sections[index];
    if (!last || !next || last.kind !== next.kind || last.contentHash !== next.contentHash) {
      return next?.kind ?? last?.kind ?? null;
    }
  }
  return null;
}

function eligiblePrefixTokens(sections: readonly SectionPlan[], first: SectionKind | null): number {
  let total = 0;
  for (const section of sections) {
    if (first !== null && section.kind === first) break;
    if (section.zone !== "stable-prefix") break;
    total += section.tokenCost;
  }
  return total;
}

export function createCacheReceipt(input: CreateCacheReceiptInput): CacheReceiptService {
  if (!input || typeof input !== "object") failMissing("input");
  if (!input.cursor || typeof input.cursor !== "object") failMissing("cursor");
  if (!input.store || typeof input.store.put !== "function" || typeof input.store.head !== "function") {
    failMissing("store");
  }
  const bound = snapshotBudgetCursor(input.cursor, "input.cursor");
  const store = input.store;

  function assertScope(cursor: RuntimeCursor, signal: AbortSignal | undefined, field: string): RuntimeCursor {
    if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
    signal?.throwIfAborted();
    let scoped: RuntimeCursor;
    try {
      scoped = snapshotBudgetCursor(cursor, field);
    } catch (error) {
      if (error instanceof BudgetError) failInput(field);
      throw error;
    }
    if (!sameCursor(bound, scoped)) throw new CacheError("PCR_CACHE_SCOPE_MISMATCH");
    return scoped;
  }

  return {
    async commit(event: CommitCacheInput): Promise<CacheReceipt> {
      if (!event || typeof event !== "object") failInput("event");
      const cursor = assertScope(event.cursor, event.signal, "event.cursor");
      const sections = snapshotPlans(event.sections, "event.sections");
      event.signal?.throwIfAborted();
      const previous = await store.head(cursor);
      event.signal?.throwIfAborted();
      const hashes = sections.map((item) => ({ kind: item.kind, contentHash: item.contentHash }));
      const viewId = `vw_${domainHash("cache-receipt", { cursor, hashes }).slice(0, 24)}`;
      const different = firstDifferent(previous, sections);
      const receipt: CacheReceiptRecord = {
        viewId,
        cursor,
        sections: sections.map((item) => ({
          kind: item.kind,
          zone: item.zone,
          contentHash: item.contentHash,
          tokenCost: item.tokenCost,
        })),
        firstDifferentSection: different,
        eligiblePrefixTokens: eligiblePrefixTokens(sections, different),
        previousViewId: previous?.viewId ?? null,
      };
      await store.put(receipt);
      return receipt;
    },
    async current(cursor: RuntimeCursor, signal?: AbortSignal): Promise<CacheReceipt | null> {
      const scoped = assertScope(cursor, signal, "cursor");
      return store.head(scoped);
    },
  };
}
