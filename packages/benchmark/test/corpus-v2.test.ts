import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CORPUS_V2_SMOKE_CLUSTERS,
  createCorpusGovernor,
  verifyLockedCorpus,
  type CorpusCase,
  type CorpusManifest,
  type CorpusStore,
} from "@pcr/benchmark";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "pcr-corpus-v2-"));
  roots.push(root);
  return root;
}

function memoryStore(rows: CorpusCase[], corpusId: string): CorpusStore & { manifests: CorpusManifest[] } {
  const manifests: CorpusManifest[] = [];
  return {
    manifests,
    async list() {
      return rows.filter((row) => row.corpusId === corpusId);
    },
    async readManifest() {
      return manifests.at(-1) ?? null;
    },
    async writeManifest(manifest) {
      manifests.push(manifest);
    },
  };
}

function clusterCases(corpusId: string, cluster: string, bodies: string[]): CorpusCase[] {
  return bodies.map((body, index) => ({
    id: `${cluster}-${String(index).padStart(2, "0")}`,
    cluster,
    corpusId,
    body,
  }));
}

describe("v2 source-witness locked corpus", () => {
  it("detects a duplicate template copied across cases", async () => {
    const corpusId = "pcr-corpus-v2";
    const template = "keep using version 7 and do not deploy production";
    const rows = clusterCases(corpusId, "temporal", [
      template,
      template,
      `${template} variant-2`,
      `${template} variant-3`,
      `${template} variant-4`,
      `${template} variant-5`,
    ]);
    const governor = createCorpusGovernor({ corpusId, store: memoryStore(rows, corpusId) });
    await expect(governor.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({
      code: "PCR_CORPUS_TEMPLATE_DUPLICATE",
    });
  });

  it("rejects an oracle whose expected value has no source witness", async () => {
    const corpusId = "pcr-corpus-v2";
    const rows = clusterCases(corpusId, "temporal", [
      "改为 version 7",
      "keep staging only",
      "do not deploy production",
      "timeout is 30ms",
      "path is src/app.ts",
      "offset is -3.5",
    ]).map((row, index) => (
      index === 0
        ? { ...row, oracleExpected: "7-tu-00" }
        : { ...row, oracleExpected: row.body }
    ));
    const governor = createCorpusGovernor({ corpusId, store: memoryStore(rows, corpusId) });
    await expect(governor.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({
      code: "PCR_CORPUS_WITNESS_MISSING",
    });
  });

  it("rejects the same template leaking across train and locked-test", async () => {
    const corpusId = "pcr-corpus-v2";
    const shared = "TEMPLATE leak-across-split keep version 7";
    const rows = clusterCases(corpusId, "constraint", [
      shared,
      "constraint unique 1 keep going",
      "constraint unique 2 keep going",
      "constraint unique 3 keep going",
      "constraint unique 4 keep going",
      shared,
    ]);
    const governor = createCorpusGovernor({ corpusId, store: memoryStore(rows, corpusId) });
    await expect(governor.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({
      code: "PCR_CORPUS_SPLIT_LEAKAGE",
    });
  });

  it("does not list cases after abort", async () => {
    let listed = 0;
    const governor = createCorpusGovernor({
      corpusId: "pcr-corpus-v2",
      store: {
        async list() {
          listed += 1;
          return [];
        },
        async readManifest() { return null; },
        async writeManifest() {},
      },
    });
    await expect(governor.lock({ benchmarkMajor: 1, signal: AbortSignal.abort() })).rejects.toThrow();
    expect(listed).toBe(0);
  });

  it("locks the v2 30-cluster smoke corpus with oracle witnesses", async () => {
    const manifest = await verifyLockedCorpus({
      root: new URL("../../../benchmarks/corpus-v2", import.meta.url).pathname,
      benchmarkMajor: 1,
      minimumClusters: CORPUS_V2_SMOKE_CLUSTERS,
    });
    expect(Object.keys(manifest.clusters)).toHaveLength(CORPUS_V2_SMOKE_CLUSTERS);
    expect(manifest.trainHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.lockedTestHash).toMatch(/^[a-f0-9]{64}$/u);
  });
});

void dataRoot;
