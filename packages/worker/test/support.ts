import { candidateKey, type CandidateSnapshot } from "../src/candidate-key.js";
import { fencingKey } from "../src/generation/head.js";
import { publishVerifiedGeneration, recoverHalfPublished, type PublishInput } from "../src/generation/publish.js";
import {
  CandidateWorker,
  type CandidateRecord,
  type CandidateStore,
  type WorkerBudgets,
} from "../src/candidate-worker.js";
import type { ContextHead, GenerationManifest, GenerationState, GenerationStore, PublishResult } from "../../storage/src/protocol.js";

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

export function generationFixture() {
  const snapshot = fixtureSnapshot();
  const fence = fencingKey({
    candidateKey: candidateKey(snapshot),
    modelKey: snapshot.modelKey,
    configFingerprint: snapshot.configFingerprint,
    reducerRevisionSet: snapshot.reducerRevisionSet,
    schemaVersion: snapshot.schemaVersion,
  });
  let head: ContextHead = { hash: "head_0", fencingKey: fence };
  const generations = new Map<string, { state: GenerationState; manifest: GenerationManifest }>();
  let seq = 0;
  const materialized: string[] = [];

  const store: GenerationStore & {
    crashBeforeCas?: boolean;
    head: () => ContextHead;
    setHead: (next: ContextHead) => void;
  } = {
    head: () => head,
    setHead(next) {
      head = next;
    },
    async rejectGeneration(generationId, reason) {
      generations.set(generationId, {
        state: "rejected",
        manifest: generations.get(generationId)?.manifest ?? {
          generationId,
          candidateKey: candidateKey(snapshot),
          sourceHead: snapshot.sourceHead,
          fencingKey: fence,
          schemaVersion: snapshot.schemaVersion,
          configFingerprint: snapshot.configFingerprint,
          reducerRevisionSet: snapshot.reducerRevisionSet,
          modelKey: snapshot.modelKey,
        },
      });
      return { kind: "rejected", reason };
    },
    async transaction(work) {
      return work({
        async getContextHead() {
          return head;
        },
        async markGenerationStale(generationId, reason) {
          const current = generations.get(generationId);
          if (current) current.state = "stale";
          else generations.set(generationId, { state: "stale", manifest: { generationId, candidateKey: candidateKey(snapshot), sourceHead: snapshot.sourceHead, fencingKey: fence, schemaVersion: snapshot.schemaVersion, configFingerprint: snapshot.configFingerprint, reducerRevisionSet: snapshot.reducerRevisionSet, modelKey: snapshot.modelKey } });
          return { kind: "stale", reason };
        },
        async insertGeneration(manifest, state) {
          generations.set(manifest.generationId, { state, manifest });
        },
        async getGeneration(generationId) {
          return generations.get(generationId);
        },
        async compareAndSwapContextHead(expectedHash, next, generationId) {
          if (store.crashBeforeCas) {
            store.crashBeforeCas = false;
            throw new Error("crash-after-insert");
          }
          if (head.hash !== expectedHash) {
            const current = generations.get(generationId);
            if (current) current.state = "stale";
            return { kind: "stale", reason: "head-changed" };
          }
          head = next;
          const current = generations.get(generationId);
          if (current) current.state = "committed";
          materialized.push(generationId);
          return { kind: "committed", head, receipt: { generationId, headHash: next.hash } };
        },
      });
    },
  };

  function manifest(generationId: string): GenerationManifest {
    return {
      generationId,
      candidateKey: candidateKey(snapshot),
      sourceHead: snapshot.sourceHead,
      fencingKey: fence,
      schemaVersion: snapshot.schemaVersion,
      configFingerprint: snapshot.configFingerprint,
      reducerRevisionSet: snapshot.reducerRevisionSet,
      modelKey: snapshot.modelKey,
    };
  }

  return {
    async prepare(): Promise<PublishInput> {
      const generationId = `gen_${++seq}`;
      const prepared = manifest(generationId);
      await store.transaction(async (tx) => tx.insertGeneration?.(prepared, "prepared"));
      return {
        generationId,
        cursor: { sessionId: snapshot.sessionId, leafId: snapshot.leafId },
        expectedHeadHash: head.hash,
        report: { ok: true },
        manifest: prepared,
      };
    },
    async appendDirective() {
      head = { hash: `head_dir_${head.hash}`, fencingKey: fence };
    },
    changeFence(next: Partial<Pick<CandidateSnapshot, "modelKey" | "configFingerprint" | "reducerRevisionSet" | "schemaVersion">>) {
      const shifted = fencingKey({
        candidateKey: candidateKey(snapshot),
        modelKey: next.modelKey ?? snapshot.modelKey,
        configFingerprint: next.configFingerprint ?? snapshot.configFingerprint,
        reducerRevisionSet: next.reducerRevisionSet ?? snapshot.reducerRevisionSet,
        schemaVersion: next.schemaVersion ?? snapshot.schemaVersion,
      });
      head = { ...head, fencingKey: shifted };
    },
    publish(prepared: PublishInput) {
      return publishVerifiedGeneration(prepared, { store });
    },
    crashBeforeCas() {
      store.crashBeforeCas = true;
    },
    recover(generationId: string) {
      return recoverHalfPublished(generationId, { store }, { sessionId: snapshot.sessionId, leafId: snapshot.leafId });
    },
    materialized: () => [...materialized],
    generationState: (id: string) => generations.get(id)?.state,
    resultOf(result: PublishResult) {
      return result;
    },
  };
}

