import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { domainHash } from "@pcr/contracts";

import {
  failConflict,
  failInput,
  failMissing,
  failRealTracesMissing,
  failScope,
  failSplitLeakage,
  failTemplateDuplicate,
  failWitnessMissing,
  failA1ShapeInvalid,
} from "./errors.js";
import type { CorpusManifest } from "./types.js";

export const CORPUS_V3_ID = "pcr-corpus-v3";

export type A1Split = "train" | "dev" | "locked-test" | "real-traces";

export interface A1SourceWitnessRef {
  ref: string;
  expected: string;
}

export interface A1ShapedBundle {
  caseId: string;
  clusterId: string;
  corpusId: string;
  split: A1Split;
  piSessionJsonl: string;
  workspaceSnapshot: Record<string, string>;
  runtimeStoreSnapshot: unknown;
  oracle: {
    sourceWitnesses: readonly A1SourceWitnessRef[];
    hardDirectives?: readonly string[];
    mustOmit?: readonly string[];
  };
  hiddenContinuation: {
    userPrompt: string;
    environmentAssertions: ReadonlyArray<{ kind: string; path?: string; expected?: string }>;
  };
  sourceWitness: { origin: string; sha256: string };
  templateId?: string;
}

const SPLITS: readonly A1Split[] = ["train", "dev", "locked-test", "real-traces"];
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

function bundleDigest(bundle: Omit<A1ShapedBundle, "sourceWitness">): string {
  return createHash("sha256").update(canonicalJson({
    caseId: bundle.caseId,
    clusterId: bundle.clusterId,
    piSessionJsonl: bundle.piSessionJsonl,
    workspaceSnapshot: bundle.workspaceSnapshot,
    runtimeStoreSnapshot: bundle.runtimeStoreSnapshot,
    hiddenContinuation: bundle.hiddenContinuation,
  }), "utf8").digest("hex");
}

export function verifyA1ShapedBundle(value: unknown): A1ShapedBundle {
  if (!value || typeof value !== "object") failA1ShapeInvalid({ field: "bundle" });
  const row = value as A1ShapedBundle;
  requireNonEmpty(row.caseId, "caseId");
  requireNonEmpty(row.clusterId, "clusterId");
  requireNonEmpty(row.corpusId, "corpusId");
  if (typeof row.split !== "string" || !SPLITS.includes(row.split)) failA1ShapeInvalid({ field: "split" });
  requireNonEmpty(row.piSessionJsonl, "piSessionJsonl");
  if (row.piSessionJsonl.length <= 400) failA1ShapeInvalid({ field: "piSessionJsonl", reason: "preview-only" });
  if (!row.workspaceSnapshot || typeof row.workspaceSnapshot !== "object" || Array.isArray(row.workspaceSnapshot)) {
    failA1ShapeInvalid({ field: "workspaceSnapshot" });
  }
  if (Object.keys(row.workspaceSnapshot).length === 0) failA1ShapeInvalid({ field: "workspaceSnapshot" });
  if (row.runtimeStoreSnapshot === undefined) failA1ShapeInvalid({ field: "runtimeStoreSnapshot" });
  if (!row.oracle || !Array.isArray(row.oracle.sourceWitnesses) || row.oracle.sourceWitnesses.length === 0) {
    failA1ShapeInvalid({ field: "oracle.sourceWitnesses" });
  }
  for (const [index, witness] of row.oracle.sourceWitnesses.entries()) {
    requireNonEmpty(witness?.ref, `oracle.sourceWitnesses[${index}].ref`);
    requireNonEmpty(witness?.expected, `oracle.sourceWitnesses[${index}].expected`);
    if (!row.piSessionJsonl.includes(witness.expected) && !Object.values(row.workspaceSnapshot).some((body) => body.includes(witness.expected))) {
      failWitnessMissing({ caseId: row.caseId, expected: witness.expected });
    }
  }
  if (!row.hiddenContinuation || typeof row.hiddenContinuation !== "object") failA1ShapeInvalid({ field: "hiddenContinuation" });
  requireNonEmpty(row.hiddenContinuation.userPrompt, "hiddenContinuation.userPrompt");
  if (!Array.isArray(row.hiddenContinuation.environmentAssertions) || row.hiddenContinuation.environmentAssertions.length === 0) {
    failA1ShapeInvalid({ field: "hiddenContinuation.environmentAssertions" });
  }
  if (!row.sourceWitness || typeof row.sourceWitness !== "object") failA1ShapeInvalid({ field: "sourceWitness" });
  requireNonEmpty(row.sourceWitness.origin, "sourceWitness.origin");
  if (!SHA256_PATTERN.test(row.sourceWitness.sha256)) failA1ShapeInvalid({ field: "sourceWitness.sha256" });
  const expectedHash = bundleDigest(row);
  if (row.sourceWitness.sha256 !== expectedHash) {
    failWitnessMissing({ caseId: row.caseId, field: "sourceWitness.sha256", expected: expectedHash });
  }
  const next: A1ShapedBundle = {
    caseId: row.caseId,
    clusterId: row.clusterId,
    corpusId: row.corpusId,
    split: row.split,
    piSessionJsonl: row.piSessionJsonl,
    workspaceSnapshot: { ...row.workspaceSnapshot },
    runtimeStoreSnapshot: row.runtimeStoreSnapshot,
    oracle: {
      sourceWitnesses: row.oracle.sourceWitnesses.map((item) => ({ ref: item.ref, expected: item.expected })),
      ...(row.oracle.hardDirectives ? { hardDirectives: [...row.oracle.hardDirectives] } : {}),
      ...(row.oracle.mustOmit ? { mustOmit: [...row.oracle.mustOmit] } : {}),
    },
    hiddenContinuation: {
      userPrompt: row.hiddenContinuation.userPrompt,
      environmentAssertions: row.hiddenContinuation.environmentAssertions.map((item) => ({ ...item })),
    },
    sourceWitness: { origin: row.sourceWitness.origin, sha256: row.sourceWitness.sha256 },
  };
  if (row.templateId !== undefined) {
    requireNonEmpty(row.templateId, "templateId");
    next.templateId = row.templateId;
  }
  return next;
}

export function a1SourceWitnessHash(bundle: Omit<A1ShapedBundle, "sourceWitness">): string {
  return bundleDigest(bundle);
}

function templateOf(row: A1ShapedBundle): string {
  return row.templateId ?? row.piSessionJsonl;
}

function assertTemplates(bundles: readonly A1ShapedBundle[]): void {
  const seenAcross = new Map<string, string>();
  const seenInSplit = new Map<string, Set<string>>();
  for (const row of bundles) {
    const template = templateOf(row);
    const inSplit = seenInSplit.get(row.split) ?? new Set<string>();
    if (inSplit.has(template)) failTemplateDuplicate({ split: row.split, template, caseId: row.caseId });
    inSplit.add(template);
    seenInSplit.set(row.split, inSplit);
    const previous = seenAcross.get(template);
    if (previous && previous !== row.split) {
      failSplitLeakage({ template, first: previous, second: row.split, caseId: row.caseId });
    }
    seenAcross.set(template, row.split);
  }
}

function hashSplit(domain: string, corpusId: string, benchmarkMajor: number, rows: readonly A1ShapedBundle[]): string {
  return domainHash(domain, {
    corpusId,
    benchmarkMajor,
    cases: rows.map((row) => ({ id: row.caseId, cluster: row.clusterId, digest: row.sourceWitness.sha256 })),
  });
}

export function lockA1Corpus(input: {
  corpusId: string;
  benchmarkMajor: number;
  bundles: readonly unknown[];
  existing?: CorpusManifest | null;
  signal?: AbortSignal;
}): CorpusManifest {
  if (!input || typeof input !== "object") failMissing("input");
  requireNonEmpty(input.corpusId, "corpusId");
  if (!Number.isSafeInteger(input.benchmarkMajor) || input.benchmarkMajor < 1) failInput("benchmarkMajor");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  if (!Array.isArray(input.bundles) || input.bundles.length === 0) failInput("bundles");
  const bundles = input.bundles.map((row, index) => {
    const verified = verifyA1ShapedBundle(row);
    if (verified.corpusId !== input.corpusId) failScope({ expected: input.corpusId, actual: verified.corpusId, index });
    return verified;
  });
  const traces = bundles.filter((row) => row.split === "real-traces");
  if (traces.length === 0) failRealTracesMissing({ corpusId: input.corpusId });
  assertTemplates(bundles);
  const clusters: Record<string, string[]> = {};
  for (const row of bundles) {
    const ids = clusters[row.clusterId] ?? [];
    ids.push(row.caseId);
    clusters[row.clusterId] = ids;
  }
  for (const name of Object.keys(clusters)) {
    clusters[name] = [...new Set(clusters[name])].sort();
  }
  const train = bundles.filter((row) => row.split === "train").sort((left, right) => left.caseId.localeCompare(right.caseId));
  const dev = bundles.filter((row) => row.split === "dev").sort((left, right) => left.caseId.localeCompare(right.caseId));
  const test = bundles.filter((row) => row.split === "locked-test").sort((left, right) => left.caseId.localeCompare(right.caseId));
  const real = traces.sort((left, right) => left.caseId.localeCompare(right.caseId));
  const computed: CorpusManifest = {
    benchmarkMajor: input.benchmarkMajor,
    trainHash: hashSplit("corpus.v3.train", input.corpusId, input.benchmarkMajor, train),
    devHash: hashSplit("corpus.v3.dev", input.corpusId, input.benchmarkMajor, dev),
    lockedTestHash: hashSplit("corpus.v3.locked-test", input.corpusId, input.benchmarkMajor, test),
    realTracesHash: hashSplit("corpus.v3.real-traces", input.corpusId, input.benchmarkMajor, real),
    clusters,
  };
  const existing = input.existing ?? null;
  if (existing) {
    if (existing.benchmarkMajor === computed.benchmarkMajor) {
      if (
        existing.trainHash === computed.trainHash
        && existing.devHash === computed.devHash
        && existing.lockedTestHash === computed.lockedTestHash
        && existing.realTracesHash === computed.realTracesHash
      ) {
        return existing;
      }
      failConflict({ benchmarkMajor: computed.benchmarkMajor, lockedTestHash: existing.lockedTestHash });
    }
    if (existing.benchmarkMajor > computed.benchmarkMajor) {
      failConflict({ benchmarkMajor: computed.benchmarkMajor, locked: existing.benchmarkMajor });
    }
  }
  return computed;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch {
    failA1ShapeInvalid({ field: path });
  }
}

function readA1Case(caseDir: string, split: A1Split): A1ShapedBundle {
  const manifestPath = join(caseDir, "manifest.json");
  const sessionPath = join(caseDir, "session.jsonl");
  const storePath = join(caseDir, "store.json");
  const workspaceDir = join(caseDir, "workspace");
  if (!existsSync(manifestPath) || !existsSync(sessionPath) || !existsSync(storePath) || !existsSync(workspaceDir)) {
    failA1ShapeInvalid({ field: "caseDir", path: caseDir });
  }
  const manifest = readJson(manifestPath) as A1ShapedBundle;
  const workspaceSnapshot: Record<string, string> = {};
  for (const name of readdirSync(workspaceDir)) {
    const file = join(workspaceDir, name);
    if (statSync(file).isFile()) workspaceSnapshot[name] = readFileSync(file, "utf8");
  }
  return verifyA1ShapedBundle({
    ...manifest,
    split,
    piSessionJsonl: readFileSync(sessionPath, "utf8"),
    runtimeStoreSnapshot: readJson(storePath),
    workspaceSnapshot: Object.keys(manifest.workspaceSnapshot ?? {}).length > 0 ? manifest.workspaceSnapshot : workspaceSnapshot,
  });
}

export function loadA1CorpusRoot(root: string): A1ShapedBundle[] {
  requireNonEmpty(root, "root");
  if (!existsSync(root)) failInput("root");
  const bundles: A1ShapedBundle[] = [];
  for (const split of SPLITS) {
    const dir = join(root, split);
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const caseDir = join(dir, name);
      if (!statSync(caseDir).isDirectory()) continue;
      bundles.push(readA1Case(caseDir, split));
    }
  }
  return bundles;
}

export function verifyA1CorpusRoot(input: {
  root: string;
  corpusId?: string;
  benchmarkMajor: number;
  signal?: AbortSignal;
}): CorpusManifest {
  if (!input || typeof input !== "object") failMissing("input");
  const corpusId = input.corpusId ?? CORPUS_V3_ID;
  const bundles = loadA1CorpusRoot(input.root);
  if (bundles.filter((row) => row.split === "real-traces").length === 0) {
    failRealTracesMissing({ root: input.root, corpusId });
  }
  return lockA1Corpus({
    corpusId,
    benchmarkMajor: input.benchmarkMajor,
    bundles,
    signal: input.signal,
  });
}
