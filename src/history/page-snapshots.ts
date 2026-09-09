import { randomUUID } from "node:crypto";

export const SEARCH_SNAPSHOT_LIMITS = { maxSnapshots: 16, maxHits: 128, ttlMs: 600_000 } as const;

export type SnapshotHit = {
  ref: string;
  entryId: string;
  blockIndex: number;
  sourceHash: string;
  excerpt: string;
};

export type SearchPageSnapshot = {
  snapshotId: string;
  workspaceId: string;
  sessionId: string;
  queryHash: string;
  configHash: string;
  anchorEntryId: string;
  createdAt: number;
  hits: SnapshotHit[];
  truncated: boolean;
};

export class SearchSnapshotStore {
  readonly maxSnapshots: number;
  readonly maxHits: number;
  readonly ttlMs: number;
  private readonly items = new Map<string, SearchPageSnapshot>();

  constructor(opts: { maxSnapshots: number; maxHits: number; ttlMs: number } = SEARCH_SNAPSHOT_LIMITS) {
    this.maxSnapshots = opts.maxSnapshots;
    this.maxHits = opts.maxHits;
    this.ttlMs = opts.ttlMs;
  }

  create(input: Omit<SearchPageSnapshot, "snapshotId">): SearchPageSnapshot {
    const snapshot: SearchPageSnapshot = { ...input, snapshotId: `ss-${randomUUID()}` };
    this.items.set(snapshot.snapshotId, snapshot);
    while (this.items.size > this.maxSnapshots) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
    return snapshot;
  }

  get(snapshotId: string, nowMs: number): SearchPageSnapshot | null {
    const snapshot = this.items.get(snapshotId);
    if (!snapshot) return null;
    if (nowMs - snapshot.createdAt > this.ttlMs) {
      this.items.delete(snapshotId);
      return null;
    }
    return snapshot;
  }

  clear(): void {
    this.items.clear();
  }
}
