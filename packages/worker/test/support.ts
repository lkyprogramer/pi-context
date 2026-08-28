import { candidateKey, type CandidateSnapshot } from "../src/candidate-key.js";
import {
  CandidateWorker,
  type CandidateRecord,
  type CandidateStore,
  type WorkerBudgets,
} from "../src/candidate-worker.js";

export function fixtureSnapshot(partial: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
  return {
    workspaceId: "ws_1",
    sessionId: "s1",
    leafId: "leaf-a",
    lineageHash: "lin-a",
    sourceHead: "src-1",
    modelKey: "model-a",
    thinkingLevel: "off",
    contextWindow: 128000,
    systemPromptHash: "sys-1",
    activeToolSetHash: "tools-1",
    reducerRevisionSet: "red-1",
    extractorRevision: "ext-1",
    schemaVersion: "1",
    configFingerprint: "cfg-1",
    ...partial,
  };
}

export function memoryStore(): CandidateStore {
  const byId = new Map<string, CandidateRecord>();
  const byKey = new Map<string, string>();
  let seq = 0;
  const put = (record: CandidateRecord): CandidateRecord => {
    byId.set(record.id, record);
    byKey.set(record.key, record.id);
    return record;
  };
  return {
    async findCandidate(key) {
      const id = byKey.get(key);
      return id ? byId.get(id) : undefined;
    },
    async markPreparing(key) {
      return put({ id: `c_${++seq}`, key, phase: "preparing" });
    },
    async markPrepared(prepared) {
      return put({ id: prepared.id, key: prepared.key, phase: "prepared" });
    },
    async markStale(id, reason) {
      const current = byId.get(id) ?? { id, key: id, phase: "preparing" };
      return put({ ...current, phase: "stale", reason });
    },
    async markCancelled(id) {
      const current = byId.get(id) ?? { id, key: id, phase: "preparing" };
      return put({ ...current, phase: "cancelled" });
    },
    async markFailed(id, reason) {
      return put({ id, key: id, phase: "failed", reason });
    },
  };
}

async function waitOrAbort(signal: AbortSignal, ms: number): Promise<void> {
  if (ms <= 0) {
    await Promise.resolve();
    if (signal.aborted) throw new Error("aborted");
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    if (signal.aborted) {
      clearTimeout(timer);
      reject(new Error("aborted"));
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function candidateWorkerFixture(opts: { budgets?: Partial<WorkerBudgets>; prepareMs?: number } = {}) {
  let cursor: Pick<CandidateSnapshot, "leafId" | "modelKey"> = { leafId: "leaf-a", modelKey: "model-a" };
  let publishCount = 0;
  const snapshot = (): CandidateSnapshot => fixtureSnapshot(cursor);
  const worker = new CandidateWorker({
    store: memoryStore(),
    snapshotProvider: { current: snapshot },
    budgets: opts.budgets,
    async prepare(current, signal) {
      await waitOrAbort(signal, opts.prepareMs ?? 0);
      return { id: `prep_${current.leafId}`, key: candidateKey(current), bytes: 16, tokens: 8 };
    },
  });
  return {
    start(partial?: Partial<CandidateSnapshot>) {
      return worker.ensure(fixtureSnapshot({ ...cursor, ...partial }));
    },
    startNoWait(partial?: Partial<CandidateSnapshot>) {
      return worker.ensure(fixtureSnapshot({ ...cursor, ...partial }), { wait: false });
    },
    changeCursor(next: Partial<Pick<CandidateSnapshot, "leafId" | "modelKey">>) {
      cursor = { ...cursor, ...next };
    },
    state: () => worker.state(),
    publishCount: () => publishCount,
    metrics: () => worker.metrics(),
    publish() {
      publishCount += 1;
    },
    shutdown: () => worker.shutdown(),
    worker,
  };
}
