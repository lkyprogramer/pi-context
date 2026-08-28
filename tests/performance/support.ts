import { mkdtempSync, rmSync } from "node:fs";
import { cpus, tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import type { HostCheckpoint, HostMessage, MaterializationInput } from "../../packages/contracts/src/index.js";
import { buildDeterministicCheckpointCandidate } from "../../packages/kernel/src/compaction/candidate.js";
import { ContextMaterializer } from "../../packages/kernel/src/materialization/materializer.js";
import { FtsCatalog } from "../../packages/kernel/src/retrieval/fts-catalog.js";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { openSqliteStore } from "../../packages/storage/src/sqlite-store.js";

export interface BenchmarkEnvironment {
  node: string;
  platform: NodeJS.Platform;
  arch: string;
  cpus: number;
  durability: "normal" | "full";
  phase: "cold" | "warm";
}

export interface BenchmarkCase {
  name: string;
  kind: "pi-clone" | "cas-fsync" | "sqlite-fts" | "materializer" | "host-compaction";
  options?: Record<string, number | string | boolean>;
}

export interface CaseResult {
  name: string;
  kind: string;
  phase: "cold" | "warm";
  samples: number[];
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  rssBytes: number;
  heapUsedBytes: number;
  gcPauseMs: number | null;
  sloRecommendationMs: number;
}

export interface PerformanceReport {
  environment: BenchmarkEnvironment;
  results: CaseResult[];
  generatedAt: string;
  sloRecommendations: Record<string, number>;
}

export function captureEnvironment(phase: "cold" | "warm" = "warm"): BenchmarkEnvironment {
  return {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpus: cpus().length,
    durability: process.platform === "darwin" ? "normal" : "full",
    phase,
  };
}

export function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function recommendSloMs(p95Ms: number): number {
  const padded = Math.max(1, p95Ms * 1.5);
  const nice = [5, 10, 20, 25, 40, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000];
  return nice.find((item) => item >= padded) ?? Math.ceil(padded);
}

async function timeSamples(iterations: number, fn: () => Promise<void> | void, warmup = 1): Promise<number[]> {
  for (let i = 0; i < warmup; i += 1) await fn();
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    await fn();
    samples.push(Number((performance.now() - start).toFixed(4)));
  }
  return samples;
}

function memorySnapshot(): { rssBytes: number; heapUsedBytes: number } {
  const usage = process.memoryUsage();
  return { rssBytes: usage.rss, heapUsedBytes: usage.heapUsed };
}

function summarize(name: string, kind: string, phase: "cold" | "warm", samples: number[]): CaseResult {
  const p50Ms = percentile(samples, 50);
  const p95Ms = percentile(samples, 95);
  const mem = memorySnapshot();
  return {
    name,
    kind,
    phase,
    samples,
    p50Ms,
    p95Ms,
    p99Ms: percentile(samples, 99),
    rssBytes: mem.rssBytes,
    heapUsedBytes: mem.heapUsedBytes,
    gcPauseMs: null,
    sloRecommendationMs: recommendSloMs(p95Ms),
  };
}

function fixtureMessages(count: number): HostMessage[] {
  const out: HostMessage[] = new Array(count);
  for (let i = 0; i < count; i += 1) {
    const user = i === count - 1 || i % 2 === 0;
    out[i] = {
      hostMessageId: `m_${i}`,
      role: user ? "user" : "assistant",
      timestamp: i,
      content: [{ type: "text", text: "n" }],
      sourceClass: user ? "authenticated-user" : "agent-derived",
    };
  }
  return out;
}

function fixtureCheckpoint(): HostCheckpoint {
  return {
    directives: [{ directiveId: "dir_keep", quote: "do not deploy prod", polarity: "must-not", status: "active" }],
    continuity: { revisionId: "cr_perf" },
    claims: [],
    pointers: [],
    heads: {
      contextHead: "ctx_perf",
      directiveHead: "dh_perf",
      claimHead: "ch_perf",
      continuityHead: "cth_perf",
      catalogHead: "cah_perf",
    },
  };
}

async function runIsolatedCase(testCase: BenchmarkCase, env: BenchmarkEnvironment): Promise<CaseResult> {
  const iterations = Number(testCase.options?.iterations ?? 8);
  switch (testCase.kind) {
    case "pi-clone": {
      const size = Number(testCase.options?.size ?? 1_000);
      const payload = fixtureMessages(size);
      const samples = await timeSamples(iterations, () => {
        structuredClone(payload);
      }, env.phase === "cold" ? 0 : 1);
      return summarize(testCase.name, testCase.kind, env.phase, samples);
    }
    case "materializer": {
      const events = Number(testCase.options?.events ?? 1_000);
      const messages = fixtureMessages(events);
      const materializer = new ContextMaterializer({
        directives: "do not deploy prod",
        historyText: "n",
        providerReservedTokens: 0,
      });
      const input: MaterializationInput = {
        cursor: {
          workspaceId: "ws_perf",
          sessionId: "s_perf",
          leafId: null,
          lineageHash: "lin",
          modelKey: "m",
          thinkingLevel: "off",
        },
        canonicalMessages: messages,
        currentContextWindow: 4_000_000,
        maxOutputTokens: 256,
        reason: "normal",
        now: 1,
      };
      const samples = await timeSamples(iterations, () => materializer.materialize(input), env.phase === "cold" ? 0 : 1);
      return summarize(testCase.name, testCase.kind, env.phase, samples);
    }
    case "cas-fsync": {
      const bytes = Number(testCase.options?.bytes ?? 256 * 1024);
      const root = mkdtempSync(join(tmpdir(), "pcr-cas-"));
      const store = new EncryptedBlobStore({
        root,
        workspaceId: "ws_perf",
        keys: new TestKeyProvider(Buffer.alloc(32, 7)),
      });
      const payload = Buffer.alloc(bytes, 9);
      try {
        const samples = await timeSamples(iterations, async () => {
          payload[0] = (payload[0] + 1) % 256;
          await store.put(payload);
        }, 1);
        return summarize(testCase.name, testCase.kind, env.phase, samples);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    }
    case "sqlite-fts": {
      const documents = Number(testCase.options?.documents ?? 1_000);
      const catalog = new FtsCatalog();
      for (let i = 0; i < documents; i += 1) {
        await catalog.upsert({
          documentId: `doc_${i}`,
          workspaceId: "ws_perf",
          sessionId: "s_perf",
          body: i % 17 === 0 ? "cache invalidation strategy" : "batch-note",
          status: "active",
          timestamp: i,
        });
      }
      await catalog.rebuild();
      const dir = mkdtempSync(join(tmpdir(), "pcr-sqlite-"));
      const store = await openSqliteStore({ path: join(dir, "store.sqlite"), workspaceId: "ws_perf" });
      try {
        const samples = await timeSamples(iterations, async () => {
          await store.transaction(async (tx) => {
            await tx.putEvidence({ evidenceId: `ev_${Date.now().toString(16)}${Math.random()}`, contentHash: "h" });
          });
          await catalog.search({ text: "cache", cursor: { workspaceId: "ws_perf" }, statuses: ["active"], limit: 8 });
        }, 1);
        return summarize(testCase.name, testCase.kind, env.phase, samples);
      } finally {
        await store.close();
        rmSync(dir, { recursive: true, force: true });
      }
    }
    case "host-compaction": {
      const samples = await timeSamples(
        iterations,
        async () => {
          await buildDeterministicCheckpointCandidate(
            {
              tokensBefore: 8_000,
              firstKeptEntryId: "entry_tail",
              retainedTail: [],
              branchScope: "main",
              head: "leaf-a",
              directives: [{ directiveId: "dir_keep", quote: "do not deploy prod" }],
              reason: "threshold",
            },
            {
              checkpoint: fixtureCheckpoint(),
              branchScope: "main",
              head: "leaf-a",
              renderedTokens: 400,
              counter: {
                countText: (text) => Math.ceil(text.length / 4),
                countMessages: (messages) => messages.length * 10,
              },
            },
          );
        },
        env.phase === "cold" ? 0 : 1,
      );
      return summarize(testCase.name, testCase.kind, env.phase, samples);
    }
    default:
      throw new Error(`unknown benchmark case ${testCase.kind}`);
  }
}

export async function runPerformanceSpikes(
  cases: BenchmarkCase[],
  env: BenchmarkEnvironment,
): Promise<PerformanceReport> {
  const results: CaseResult[] = [];
  for (const testCase of cases) results.push(await runIsolatedCase(testCase, env));
  return {
    environment: env,
    results,
    generatedAt: new Date().toISOString(),
    sloRecommendations: Object.fromEntries(results.map((item) => [item.name, item.sloRecommendationMs])),
  };
}

export async function measureMaterializationFixture(opts: { events: number; iterations: number }): Promise<{
  samples: number[];
  environment: { node: string };
  p50Ms: number;
  p95Ms: number;
}> {
  const report = await runPerformanceSpikes(
    [{ name: "materializer", kind: "materializer", options: { events: opts.events, iterations: opts.iterations } }],
    captureEnvironment("warm"),
  );
  const result = report.results[0];
  if (!result) throw new Error("runPerformanceSpikes produced no materializer samples");
  return {
    samples: result.samples,
    environment: { node: report.environment.node },
    p50Ms: result.p50Ms,
    p95Ms: result.p95Ms,
  };
}

export async function measurePiCloneFixture(opts: { sizes: number[]; iterations: number }): Promise<{
  environment: { platform: string };
  results: Array<{ name: string; samples: number[]; p50Ms: number; p95Ms: number }>;
}> {
  const report = await runPerformanceSpikes(
    opts.sizes.map((size) => ({
      name: `clone-${size === 1_000 ? "1k" : size === 10_000 ? "10k" : "100k"}`,
      kind: "pi-clone" as const,
      options: { size, iterations: opts.iterations },
    })),
    captureEnvironment("warm"),
  );
  return {
    environment: { platform: report.environment.platform },
    results: report.results.map((item) => ({
      name: item.name,
      samples: item.samples,
      p50Ms: item.p50Ms,
      p95Ms: item.p95Ms,
    })),
  };
}

export async function runCliSpikes(): Promise<PerformanceReport> {
  const full = process.env.PCR_PERF_FULL === "1";
  return runPerformanceSpikes(
    [
      { name: "clone-1k-cold", kind: "pi-clone", options: { size: 1_000, iterations: 8 } },
      { name: "clone-10k", kind: "pi-clone", options: { size: 10_000, iterations: 8 } },
      { name: "clone-100k", kind: "pi-clone", options: { size: 100_000, iterations: 4 } },
      { name: "cas-256kb", kind: "cas-fsync", options: { bytes: 256 * 1024, iterations: 8 } },
      { name: "sqlite-fts", kind: "sqlite-fts", options: { documents: full ? 1_000_000 : 5_000, iterations: 6 } },
      { name: "materializer-1k", kind: "materializer", options: { events: 1_000, iterations: 8 } },
      { name: "host-compaction-soak", kind: "host-compaction", options: { iterations: 40 } },
    ],
    captureEnvironment("warm"),
  );
}
