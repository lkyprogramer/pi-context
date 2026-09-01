import { domainHash } from "@pcr/contracts";

import {
  CorpusGovernorError,
  failConflict,
  failInput,
  failMissing,
  failScope,
  failSplitLeakage,
  failTemplateDuplicate,
  failWitnessMissing,
} from "./errors.js";
import type {
  CorpusCase,
  CorpusGovernor,
  CorpusManifest,
  CorpusStore,
  CreateCorpusGovernorInput,
  LockCorpusInput,
} from "./types.js";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function snapshotStore(store: unknown): CorpusStore {
  if (!store || typeof store !== "object") failMissing("store");
  const candidate = store as CorpusStore;
  if (typeof candidate.list !== "function") failMissing("store.list");
  if (typeof candidate.readManifest !== "function") failMissing("store.readManifest");
  if (typeof candidate.writeManifest !== "function") failMissing("store.writeManifest");
  return candidate;
}

function snapshotCase(value: unknown, field: string): CorpusCase {
  if (!value || typeof value !== "object") failInput(field);
  const row = value as CorpusCase;
  requireNonEmpty(row.id, `${field}.id`);
  requireNonEmpty(row.cluster, `${field}.cluster`);
  requireNonEmpty(row.corpusId, `${field}.corpusId`);
  if (typeof row.body !== "string") failInput(`${field}.body`);
  const next: CorpusCase = { id: row.id, cluster: row.cluster, corpusId: row.corpusId, body: row.body };
  if (row.templateId !== undefined) {
    requireNonEmpty(row.templateId, `${field}.templateId`);
    next.templateId = row.templateId;
  }
  if (row.oracleExpected !== undefined) {
    requireNonEmpty(row.oracleExpected, `${field}.oracleExpected`);
    next.oracleExpected = row.oracleExpected;
  }
  return next;
}

function snapshotManifest(value: CorpusManifest | null): CorpusManifest | null {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) failInput("manifest");
  if (!Number.isSafeInteger(value.benchmarkMajor) || value.benchmarkMajor < 1) failInput("manifest.benchmarkMajor");
  requireNonEmpty(value.trainHash, "manifest.trainHash");
  requireNonEmpty(value.devHash, "manifest.devHash");
  requireNonEmpty(value.lockedTestHash, "manifest.lockedTestHash");
  if (!SHA256_PATTERN.test(value.trainHash)) failInput("manifest.trainHash");
  if (!SHA256_PATTERN.test(value.devHash)) failInput("manifest.devHash");
  if (!SHA256_PATTERN.test(value.lockedTestHash)) failInput("manifest.lockedTestHash");
  if (!value.clusters || typeof value.clusters !== "object" || Array.isArray(value.clusters)) failInput("manifest.clusters");
  const clusters: Record<string, string[]> = {};
  for (const name of Object.keys(value.clusters).sort()) {
    requireNonEmpty(name, "manifest.clusters");
    const ids = value.clusters[name];
    if (!Array.isArray(ids) || ids.length === 0) failInput(`manifest.clusters.${name}`);
    clusters[name] = ids.map((id, index) => {
      requireNonEmpty(id, `manifest.clusters.${name}[${index}]`);
      return id;
    });
  }
  if (Object.keys(clusters).length === 0) failInput("manifest.clusters");
  const next: CorpusManifest = {
    benchmarkMajor: value.benchmarkMajor,
    trainHash: value.trainHash,
    devHash: value.devHash,
    lockedTestHash: value.lockedTestHash,
    clusters,
  };
  if (value.realTracesHash !== undefined) {
    requireNonEmpty(value.realTracesHash, "manifest.realTracesHash");
    if (!SHA256_PATTERN.test(value.realTracesHash)) failInput("manifest.realTracesHash");
    next.realTracesHash = value.realTracesHash;
  }
  return freezeManifest(next);
}

function freezeManifest(manifest: CorpusManifest): CorpusManifest {
  const clusters: Record<string, string[]> = {};
  for (const name of Object.keys(manifest.clusters).sort()) {
    clusters[name] = Object.freeze([...manifest.clusters[name]]) as string[];
  }
  return Object.freeze({
    benchmarkMajor: manifest.benchmarkMajor,
    trainHash: manifest.trainHash,
    devHash: manifest.devHash,
    lockedTestHash: manifest.lockedTestHash,
    ...(manifest.realTracesHash === undefined ? {} : { realTracesHash: manifest.realTracesHash }),
    clusters: Object.freeze(clusters),
  });
}

function sameManifest(left: CorpusManifest, right: CorpusManifest): boolean {
  if (left.benchmarkMajor !== right.benchmarkMajor) return false;
  if (left.trainHash !== right.trainHash) return false;
  if (left.devHash !== right.devHash) return false;
  if (left.lockedTestHash !== right.lockedTestHash) return false;
  if ((left.realTracesHash ?? null) !== (right.realTracesHash ?? null)) return false;
  const leftKeys = Object.keys(left.clusters);
  const rightKeys = Object.keys(right.clusters);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    const leftIds = left.clusters[key] ?? [];
    const rightIds = right.clusters[key] ?? [];
    if (leftIds.length !== rightIds.length) return false;
    for (let index = 0; index < leftIds.length; index += 1) {
      if (leftIds[index] !== rightIds[index]) return false;
    }
  }
  return true;
}

function hashSplit(
  domain: string,
  corpusId: string,
  benchmarkMajor: number,
  cases: readonly CorpusCase[],
): string {
  return domainHash(domain, {
    corpusId,
    benchmarkMajor,
    cases: cases.map((row) => ({ id: row.id, cluster: row.cluster, body: row.body })),
  });
}

function assignSplits(cases: readonly CorpusCase[]): {
  train: CorpusCase[];
  dev: CorpusCase[];
  test: CorpusCase[];
  clusters: Record<string, string[]>;
} {
  const grouped = new Map<string, CorpusCase[]>();
  const seen = new Set<string>();
  for (const row of cases) {
    if (seen.has(row.id)) failInput("cases.id");
    seen.add(row.id);
    const bucket = grouped.get(row.cluster) ?? [];
    bucket.push(row);
    grouped.set(row.cluster, bucket);
  }
  if (grouped.size === 0) failInput("cases");
  const clusters: Record<string, string[]> = {};
  const train: CorpusCase[] = [];
  const dev: CorpusCase[] = [];
  const test: CorpusCase[] = [];
  for (const name of [...grouped.keys()].sort()) {
    const rows = grouped.get(name) ?? [];
    rows.sort((left, right) => left.id.localeCompare(right.id));
    if (rows.length < 3) failInput(`clusters.${name}`);
    const holdout = Math.max(1, Math.floor(rows.length / 6));
    const trainEnd = rows.length - holdout * 2;
    if (trainEnd < 1) failInput(`clusters.${name}`);
    clusters[name] = rows.map((row) => row.id);
    train.push(...rows.slice(0, trainEnd));
    dev.push(...rows.slice(trainEnd, trainEnd + holdout));
    test.push(...rows.slice(trainEnd + holdout));
  }
  train.sort((left, right) => left.id.localeCompare(right.id));
  dev.sort((left, right) => left.id.localeCompare(right.id));
  test.sort((left, right) => left.id.localeCompare(right.id));
  return { train, dev, test, clusters };
}

function templateOf(row: CorpusCase): string {
  return row.templateId ?? row.body;
}

function assertWitnesses(cases: readonly CorpusCase[]): void {
  for (const row of cases) {
    if (row.oracleExpected && !row.body.includes(row.oracleExpected)) {
      failWitnessMissing({ caseId: row.id, expected: row.oracleExpected });
    }
  }
}

function assertTemplates(splits: { train: CorpusCase[]; dev: CorpusCase[]; test: CorpusCase[] }): void {
  const bySplit: Array<{ name: "train" | "dev" | "test"; rows: CorpusCase[] }> = [
    { name: "train", rows: splits.train },
    { name: "dev", rows: splits.dev },
    { name: "test", rows: splits.test },
  ];
  const seenAcross = new Map<string, string>();
  for (const split of bySplit) {
    const seenInSplit = new Set<string>();
    for (const row of split.rows) {
      const template = templateOf(row);
      if (seenInSplit.has(template)) failTemplateDuplicate({ split: split.name, template, caseId: row.id });
      seenInSplit.add(template);
      const previous = seenAcross.get(template);
      if (previous && previous !== split.name) {
        failSplitLeakage({ template, first: previous, second: split.name, caseId: row.id });
      }
      seenAcross.set(template, split.name);
    }
  }
}

export function createCorpusGovernor(input: CreateCorpusGovernorInput): CorpusGovernor {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const corpusId = input.corpusId;
  const store = snapshotStore(input.store);
  return {
    async lock(request: LockCorpusInput): Promise<CorpusManifest> {
      if (!request || typeof request !== "object") failInput("request");
      if (!Number.isSafeInteger(request.benchmarkMajor) || request.benchmarkMajor < 1) failInput("benchmarkMajor");
      if (request.signal !== undefined && !(request.signal instanceof AbortSignal)) failInput("signal");
      request.signal?.throwIfAborted();
      const listed = await store.list();
      if (!Array.isArray(listed) || listed.length === 0) failInput("cases");
      const cases = listed.map((row, index) => snapshotCase(row, `cases[${index}]`));
      for (const row of cases) {
        if (row.corpusId !== corpusId) failScope({ expected: corpusId, actual: row.corpusId });
      }
      const splits = assignSplits(cases);
      assertWitnesses(cases);
      assertTemplates(splits);
      const computed = freezeManifest({
        benchmarkMajor: request.benchmarkMajor,
        trainHash: hashSplit("corpus.train", corpusId, request.benchmarkMajor, splits.train),
        devHash: hashSplit("corpus.dev", corpusId, request.benchmarkMajor, splits.dev),
        lockedTestHash: hashSplit("corpus.locked-test", corpusId, request.benchmarkMajor, splits.test),
        clusters: splits.clusters,
      });
      const existing = snapshotManifest(await store.readManifest());
      if (existing) {
        if (existing.benchmarkMajor === computed.benchmarkMajor) {
          if (sameManifest(existing, computed)) return existing;
          failConflict({
            benchmarkMajor: computed.benchmarkMajor,
            lockedTestHash: existing.lockedTestHash,
          });
        }
        if (existing.benchmarkMajor > computed.benchmarkMajor) {
          failConflict({
            benchmarkMajor: computed.benchmarkMajor,
            locked: existing.benchmarkMajor,
          });
        }
      }
      request.signal?.throwIfAborted();
      await store.writeManifest(computed);
      return computed;
    },
  };
}

export { CorpusGovernorError };
