import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createCorpusGovernor,
  createFileCorpusStore,
  type CorpusCase,
  type CorpusManifest,
  type CorpusStore,
} from "@pcr/benchmark";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true });
});

function dataRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "t39-"));
  roots.push(root);
  return root;
}

function casesFor(corpusId: string): CorpusCase[] {
  const clusters = ["temporal", "negation", "tool-noise"];
  const rows: CorpusCase[] = [];
  for (const cluster of clusters) {
    for (let index = 0; index < 6; index += 1) {
      rows.push({
        id: `${cluster}-${String(index).padStart(2, "0")}`,
        cluster,
        corpusId,
        body: `${cluster} body ${index} keep version 7`,
      });
    }
  }
  return rows;
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

async function runT39Fixture() {
  const corpusId = "pcr-bench-t39";
  const store = memoryStore(casesFor(corpusId), corpusId);
  const governor = createCorpusGovernor({ corpusId, store });
  const first = await governor.lock({ benchmarkMajor: 1 });
  expect(first.benchmarkMajor).toBe(1);
  expect(first.trainHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.devHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.lockedTestHash).toMatch(/^[a-f0-9]{64}$/u);
  expect(Object.keys(first.clusters).sort()).toEqual(["negation", "temporal", "tool-noise"]);
  expect(first.clusters.temporal).toHaveLength(6);
  const replayed = await governor.lock({ benchmarkMajor: 1 });
  expect(replayed).toEqual(first);
  const mutated = memoryStore(
    casesFor(corpusId).map((row) => (
      row.id.endsWith("05") ? { ...row, body: `${row.body} FILLER ${"x".repeat(80)}` } : row
    )),
    corpusId,
  );
  mutated.manifests.push(first);
  const blocked = createCorpusGovernor({ corpusId, store: mutated });
  await expect(blocked.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({
    code: "PCR_CORPUS_LOCK_CONFLICT",
  });
  const bumped = await blocked.lock({ benchmarkMajor: 2 });
  expect(bumped.benchmarkMajor).toBe(2);
  expect(bumped.lockedTestHash).not.toBe(first.lockedTestHash);
  return { ok: true as const, task: "T39" as const, manifest: first };
}

describe("T39 Benchmark corpus governance and locked splits", () => {
  it("benchmark_corpus_governance_and_locked_splits", async () => {
    await expect(runT39Fixture()).resolves.toMatchObject({ ok: true, task: "T39" });
  });

  it("fails construction when production dependencies are absent", () => {
    expect(() => createCorpusGovernor({} as never)).toThrowError(
      expect.objectContaining({ code: "PCR_CORPUS_DEPENDENCY_MISSING" }),
    );
  });

  it("rejects malformed lock input and empty clusters", async () => {
    const corpusId = "pcr-bench-t39";
    const governor = createCorpusGovernor({
      corpusId,
      store: memoryStore(casesFor(corpusId), corpusId),
    });
    await expect(governor.lock({} as never)).rejects.toMatchObject({ code: "PCR_CORPUS_INPUT_INVALID" });
    const empty = createCorpusGovernor({
      corpusId,
      store: memoryStore([{ id: "x", cluster: "", corpusId, body: "x" }], corpusId),
    });
    await expect(empty.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({ code: "PCR_CORPUS_INPUT_INVALID" });
  });

  it("replays equal manifests for the same major and cases", async () => {
    const corpusId = "pcr-bench-t39";
    const governor = createCorpusGovernor({
      corpusId,
      store: memoryStore(casesFor(corpusId), corpusId),
    });
    const first = await governor.lock({ benchmarkMajor: 1 });
    const second = await governor.lock({ benchmarkMajor: 1 });
    expect(second).toEqual(first);
  });

  it("rejects cases from another corpus id", async () => {
    const governor = createCorpusGovernor({
      corpusId: "pcr-bench-t39",
      store: memoryStore(casesFor("pcr-bench-other"), "pcr-bench-other"),
    });
    await expect(governor.lock({ benchmarkMajor: 1 })).rejects.toMatchObject({
      code: "PCR_CORPUS_SCOPE_MISMATCH",
    });
  });

  it("stops at the abort boundary before listing cases", async () => {
    let listed = 0;
    const governor = createCorpusGovernor({
      corpusId: "pcr-bench-t39",
      store: {
        async list() {
          listed += 1;
          throw new Error("should not list");
        },
        async readManifest() { return null; },
        async writeManifest() {},
      },
    });
    await expect(governor.lock({
      benchmarkMajor: 1,
      signal: AbortSignal.abort(),
    })).rejects.toThrow();
    expect(listed).toBe(0);
  });

  it("locks a file-backed corpus with two-run equality", async () => {
    const root = dataRoot();
    const corpusId = "pcr-bench-t39-file";
    await writeFile(join(root, "cases.json"), `${JSON.stringify(casesFor(corpusId), null, 2)}\n`);
    const store = createFileCorpusStore({ root, corpusId });
    const governor = createCorpusGovernor({ corpusId, store });
    const first = await governor.lock({ benchmarkMajor: 1 });
    const second = await governor.lock({ benchmarkMajor: 1 });
    expect(second).toEqual(first);
    const disk = JSON.parse(await readFile(join(root, "corpus.json"), "utf8")) as CorpusManifest;
    expect(disk).toEqual(first);
  });
});
