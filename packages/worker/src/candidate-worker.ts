import { candidateKey, sameCandidateKey, type CandidateSnapshot } from "./candidate-key.js";

export type CandidatePhase = "idle" | "preparing" | "prepared" | "stale" | "cancelled" | "failed";

export interface CandidateRecord {
  id: string;
  key: string;
  phase: CandidatePhase;
  reason?: string;
}

export type CandidateState = CandidateRecord;

export interface CandidateStore {
  findCandidate(key: string): Promise<CandidateRecord | undefined>;
  markPreparing(key: string): Promise<CandidateRecord>;
  markPrepared(prepared: { id: string; key: string }): Promise<CandidateRecord>;
  markStale(id: string, reason: string): Promise<CandidateRecord>;
  markCancelled(id: string): Promise<CandidateRecord>;
  markFailed(id: string, reason: string): Promise<CandidateRecord>;
}

export interface SnapshotProvider {
  current(): Promise<CandidateSnapshot> | CandidateSnapshot;
}

export interface WorkerBudgets {
  maxActiveJobs: number;
  maxQueue: number;
  maxDiskBytes: number;
  maxModelTokens: number;
}

export interface PreparedCandidate {
  id: string;
  key: string;
  bytes?: number;
  tokens?: number;
}

export interface CandidateMetrics {
  stale: number;
  wastedTokens: number;
  readyHit: number;
}

export class CandidateWorker {
  private phase: CandidatePhase = "idle";
  private readonly jobs = new Map<string, Promise<CandidateRecord>>();
  private readonly abort = new AbortController();
  private diskBytes = 0;
  private modelTokens = 0;
  private staleCount = 0;
  private wastedTokens = 0;
  private readonly budgets: WorkerBudgets;

  constructor(
    private readonly deps: {
      store: CandidateStore;
      snapshotProvider: SnapshotProvider;
      prepare: (snapshot: CandidateSnapshot, signal: AbortSignal) => Promise<PreparedCandidate>;
      budgets?: Partial<WorkerBudgets>;
    },
  ) {
    this.budgets = {
      maxActiveJobs: 1,
      maxQueue: 1,
      maxDiskBytes: 1_000_000,
      maxModelTokens: 8_000,
      ...deps.budgets,
    };
  }

  state(): CandidatePhase {
    return this.phase;
  }

  metrics(): CandidateMetrics {
    return { stale: this.staleCount, wastedTokens: this.wastedTokens, readyHit: 0 };
  }

  ensure(snapshot: CandidateSnapshot, opts?: { wait?: boolean }): Promise<CandidateRecord> {
    if (this.abort.signal.aborted) {
      this.phase = "cancelled";
      return Promise.resolve({ id: "none", key: candidateKey(snapshot), phase: "cancelled" });
    }
    const key = candidateKey(snapshot);
    const existingJob = this.jobs.get(key);
    if (existingJob) {
      if (opts?.wait === false) return Promise.resolve({ id: "pending", key, phase: "preparing" });
      return existingJob;
    }
    if (this.jobs.size >= this.budgets.maxActiveJobs && this.jobs.size - this.budgets.maxActiveJobs >= this.budgets.maxQueue) {
      this.phase = "failed";
      return this.deps.store.markFailed("queue", "queue-budget");
    }
    const job = this.begin(snapshot, key);
    this.jobs.set(key, job);
    void job.finally(() => {
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    });
    if (opts?.wait === false) {
      this.phase = "preparing";
      return Promise.resolve({ id: "pending", key, phase: "preparing" });
    }
    return job;
  }

  async shutdown(): Promise<void> {
    this.abort.abort();
    await Promise.allSettled([...this.jobs.values()]);
    this.jobs.clear();
    this.phase = "cancelled";
  }

  private async begin(snapshot: CandidateSnapshot, key: string): Promise<CandidateRecord> {
    const existing = await this.deps.store.findCandidate(key);
    if (existing && (existing.phase === "prepared" || existing.phase === "preparing")) return existing;
    if (this.diskBytes >= this.budgets.maxDiskBytes || this.modelTokens >= this.budgets.maxModelTokens) {
      this.phase = "failed";
      return this.deps.store.markFailed("budget", "resource-budget");
    }
    return this.run(snapshot, key);
  }

  private async run(snapshot: CandidateSnapshot, key: string): Promise<CandidateRecord> {
    this.phase = "preparing";
    const preparing = await this.deps.store.markPreparing(key);
    try {
      const prepared = await this.deps.prepare(snapshot, this.abort.signal);
      if (this.abort.signal.aborted) {
        this.waste(prepared.tokens);
        this.phase = "cancelled";
        return this.deps.store.markCancelled(preparing.id);
      }
      const current = await this.deps.snapshotProvider.current();
      if (!sameCandidateKey(key, candidateKey(current))) {
        this.staleCount += 1;
        this.waste(prepared.tokens);
        this.phase = "stale";
        return this.deps.store.markStale(preparing.id, "snapshot-changed");
      }
      this.diskBytes += prepared.bytes ?? 0;
      this.modelTokens += prepared.tokens ?? 0;
      this.phase = "prepared";
      return this.deps.store.markPrepared(prepared);
    } catch {
      if (this.abort.signal.aborted) {
        this.phase = "cancelled";
        return this.deps.store.markCancelled(preparing.id);
      }
      this.phase = "failed";
      return this.deps.store.markFailed(preparing.id, "failed");
    }
  }

  private waste(tokens: number | undefined): void {
    this.wastedTokens += tokens ?? 0;
  }
}

export { candidateKey, sameCandidateKey, type CandidateSnapshot } from "./candidate-key.js";
