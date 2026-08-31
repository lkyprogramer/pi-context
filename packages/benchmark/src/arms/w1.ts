import { createHash } from "node:crypto";

import { domainHash, type RuntimeCursor } from "@pcr/contracts";

import { validateOracle, type Oracle, type RawTrace, type RawTraceEntry } from "../oracle/index.js";
import type { CorpusManifest } from "../corpus/index.js";

export type W1ArmId = "A0" | "A1" | "A2";

export interface ArmResult {
  caseId: string;
  arm: W1ArmId;
  seed: number;
  sourceTraceHash: string;
  lockedTestHash: string;
  benchmarkMajor: number;
  clusterId: string;
  compactor: "pi-native";
  ingress: "pass-through" | "w1";
  recall: "off" | "manual-only" | "proactive";
  visibleText: string;
  visibleTokens: number;
  rawHash: string | null;
  exactReadHash: string | null;
  recallInjections: readonly string[];
}

export interface W1ArmRunner {
  run(caseId: string, arm: W1ArmId, seed: number, signal?: AbortSignal): Promise<ArmResult>;
}

export interface W1ArmCase {
  caseId: string;
  clusterId: string;
  corpusId: string;
  trace: RawTrace;
  oracle: Oracle;
}

export interface W1ArmCaseCatalog {
  get(caseId: string): Promise<W1ArmCase | null>;
}

export interface W1IngestedObservation {
  rawBlobId: string;
  operationId: string;
  observationId: string;
}

export interface W1ReducedView {
  visibleText: string;
  facts: readonly unknown[];
  reducerId: string;
}

export interface W1IngressPort {
  ingest(input: {
    cursor: RuntimeCursor;
    operationId: string;
    toolCallId: string;
    toolName: string;
    text: string;
    capturedAt: number;
    signal?: AbortSignal;
  }): Promise<W1IngestedObservation>;
  reduce(input: {
    cursor: RuntimeCursor;
    toolName: string;
    toolCallId: string;
    text: string;
    rawBlobId: string;
    signal?: AbortSignal;
  }): Promise<W1ReducedView>;
  admit(input: {
    cursor: RuntimeCursor;
    operationId: string;
    observationId: string;
    rawBlobId: string;
    reducerId: string;
    facts: readonly unknown[];
    visibleText: string;
    signal?: AbortSignal;
  }): Promise<{ evidenceId: string }>;
  readExact(input: {
    cursor: RuntimeCursor;
    evidenceId: string;
    signal?: AbortSignal;
  }): Promise<{ sha256: string }>;
}

export interface W1RecallPort {
  decide(input: {
    cursor: RuntimeCursor;
    userText: string;
    maxTokens: number;
    signal?: AbortSignal;
  }): Promise<{ quotes: readonly string[] }>;
}

export interface CreateW1ArmRunnerInput {
  corpusId: string;
  manifest: CorpusManifest;
  cursor: RuntimeCursor;
  cases: W1ArmCaseCatalog;
  ingress: W1IngressPort;
  recall: W1RecallPort;
}

export type W1ArmErrorCode =
  | "PCR_W1_DEPENDENCY_MISSING"
  | "PCR_W1_INPUT_INVALID"
  | "PCR_W1_SCOPE_MISMATCH"
  | "PCR_W1_ORACLE_INVALID";

export class W1ArmError extends TypeError {
  readonly code: W1ArmErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: W1ArmErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "W1ArmError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const ARMS = new Set<W1ArmId>(["A0", "A1", "A2"]);
const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function failMissing(dependency: string): never {
  throw new W1ArmError("PCR_W1_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new W1ArmError("PCR_W1_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new W1ArmError("PCR_W1_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFunction(value: unknown, dependency: string): void {
  if (typeof value !== "function") failMissing(dependency);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function snapshotCursor(value: RuntimeCursor, field = "cursor"): RuntimeCursor {
  if (!value || typeof value !== "object") failMissing(field);
  const cursor: RuntimeCursor = {
    workspaceId: value.workspaceId,
    sessionId: value.sessionId,
    leafId: value.leafId,
    lineageHash: value.lineageHash,
    modelKey: value.modelKey,
  };
  if (!WORKSPACE_PATTERN.test(cursor.workspaceId)) failInput(`${field}.workspaceId`);
  requireNonEmpty(cursor.sessionId, `${field}.sessionId`);
  if (cursor.leafId !== null) requireNonEmpty(cursor.leafId, `${field}.leafId`);
  if (!SHA256_PATTERN.test(cursor.lineageHash)) failInput(`${field}.lineageHash`);
  requireNonEmpty(cursor.modelKey, `${field}.modelKey`);
  return Object.freeze(cursor);
}

function snapshotManifest(value: unknown): CorpusManifest {
  if (!value || typeof value !== "object") failMissing("manifest");
  const manifest = value as CorpusManifest;
  if (!Number.isSafeInteger(manifest.benchmarkMajor) || manifest.benchmarkMajor < 1) failInput("manifest.benchmarkMajor");
  requireNonEmpty(manifest.lockedTestHash, "manifest.lockedTestHash");
  if (!SHA256_PATTERN.test(manifest.lockedTestHash)) failInput("manifest.lockedTestHash");
  requireNonEmpty(manifest.trainHash, "manifest.trainHash");
  requireNonEmpty(manifest.devHash, "manifest.devHash");
  if (!manifest.clusters || typeof manifest.clusters !== "object" || Array.isArray(manifest.clusters)) {
    failMissing("manifest.clusters");
  }
  const clusters: Record<string, string[]> = {};
  for (const name of Object.keys(manifest.clusters).sort()) {
    const ids = manifest.clusters[name];
    if (!Array.isArray(ids) || ids.length === 0) failInput(`manifest.clusters.${name}`);
    clusters[name] = ids.map((id, index) => {
      requireNonEmpty(id, `manifest.clusters.${name}[${index}]`);
      return id;
    });
  }
  if (Object.keys(clusters).length === 0) failMissing("manifest.clusters");
  return {
    benchmarkMajor: manifest.benchmarkMajor,
    trainHash: manifest.trainHash,
    devHash: manifest.devHash,
    lockedTestHash: manifest.lockedTestHash,
    clusters,
  };
}

function snapshotIngress(value: unknown): W1IngressPort {
  if (!value || typeof value !== "object") failMissing("ingress");
  const port = value as W1IngressPort;
  requireFunction(port.ingest, "ingress.ingest");
  requireFunction(port.reduce, "ingress.reduce");
  requireFunction(port.admit, "ingress.admit");
  requireFunction(port.readExact, "ingress.readExact");
  return port;
}

function snapshotRecall(value: unknown): W1RecallPort {
  if (!value || typeof value !== "object") failMissing("recall");
  requireFunction((value as W1RecallPort).decide, "recall.decide");
  return value as W1RecallPort;
}

function clusterOf(manifest: CorpusManifest, caseId: string): string | undefined {
  for (const [name, ids] of Object.entries(manifest.clusters)) {
    if (ids.includes(caseId)) return name;
  }
  return undefined;
}

function sourceTraceHash(caseId: string, entries: readonly RawTraceEntry[]): string {
  return domainHash("w1.source-trace", {
    caseId,
    entries: entries.map((entry) => ({ id: entry.entryId, role: entry.role, text: entry.text })),
  });
}

function visibleTokens(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

function freezeResult(result: ArmResult): ArmResult {
  return Object.freeze({
    ...result,
    recallInjections: Object.freeze([...result.recallInjections]),
  });
}

function lastUserText(entries: readonly RawTraceEntry[]): string {
  const users = entries.filter((entry) => entry.role === "user");
  return users.at(-1)?.text ?? "";
}

export function createW1ArmRunner(input: CreateW1ArmRunnerInput): W1ArmRunner {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const corpusId = input.corpusId;
  const manifest = snapshotManifest(input.manifest);
  const cursor = snapshotCursor(input.cursor, "input.cursor");
  if (!input.cases || typeof input.cases.get !== "function") failMissing("cases");
  const cases = input.cases;
  const ingress = snapshotIngress(input.ingress);
  const recall = snapshotRecall(input.recall);
  return {
    async run(caseId: string, arm: W1ArmId, seed: number, signal?: AbortSignal): Promise<ArmResult> {
      requireNonEmpty(caseId, "caseId");
      if (typeof arm !== "string" || !ARMS.has(arm)) failInput("arm");
      if (!Number.isSafeInteger(seed) || seed < 0) failInput("seed");
      if (signal !== undefined && !(signal instanceof AbortSignal)) failInput("signal");
      signal?.throwIfAborted();
      const clusterId = clusterOf(manifest, caseId);
      if (!clusterId) failInput("caseId");
      const record = await cases.get(caseId);
      if (!record) failInput("caseId");
      if (record.caseId !== caseId) failInput("case.caseId");
      if (record.corpusId !== corpusId) failScope({ expected: corpusId, actual: record.corpusId });
      if (record.clusterId !== clusterId) failInput("case.clusterId");
      if (!record.trace || !Array.isArray(record.trace.entries) || record.trace.entries.length === 0) failInput("case.trace");
      if (record.trace.workspaceId && record.trace.workspaceId !== cursor.workspaceId) {
        failScope({ field: "workspaceId", expected: cursor.workspaceId, actual: record.trace.workspaceId });
      }
      if (record.trace.sessionId && record.trace.sessionId !== cursor.sessionId) {
        failScope({ field: "sessionId", expected: cursor.sessionId, actual: record.trace.sessionId });
      }
      const oracle = validateOracle(record.trace, record.oracle);
      if (!oracle.ok) throw new W1ArmError("PCR_W1_ORACLE_INVALID", { code: oracle.code, itemId: oracle.itemId });
      const entries = record.trace.entries;
      const tools = entries.filter((entry) => entry.role === "toolResult");
      const rawHash = tools.length === 0 ? null : sha256(tools.map((entry) => entry.text).join("\n"));
      const parts: string[] = [];
      let exactReadHash: string | null = null;
      if (arm === "A0") {
        for (const entry of entries) {
          if (entry.role === "assistant") continue;
          parts.push(entry.text);
        }
      } else {
        for (const entry of entries) {
          if (entry.role === "user") {
            parts.push(entry.text);
            continue;
          }
          if (entry.role !== "toolResult") continue;
          signal?.throwIfAborted();
          const operationId = `op_${caseId}_${arm}_${entry.entryId}_${seed}`;
          const ingested = await ingress.ingest({
            cursor,
            operationId,
            toolCallId: entry.entryId,
            toolName: "bash",
            text: entry.text,
            capturedAt: 42,
            signal,
          });
          const reduced = await ingress.reduce({
            cursor,
            toolName: "bash",
            toolCallId: entry.entryId,
            text: entry.text,
            rawBlobId: ingested.rawBlobId,
            signal,
          });
          if (typeof reduced.visibleText !== "string") failInput("ingress.reduce.visibleText");
          const admitted = await ingress.admit({
            cursor,
            operationId: ingested.operationId,
            observationId: ingested.observationId,
            rawBlobId: ingested.rawBlobId,
            reducerId: reduced.reducerId,
            facts: reduced.facts,
            visibleText: reduced.visibleText,
            signal,
          });
          const exact = await ingress.readExact({ cursor, evidenceId: admitted.evidenceId, signal });
          exactReadHash = exact.sha256;
          parts.push(reduced.visibleText);
        }
      }
      let recallInjections: readonly string[] = [];
      if (arm === "A2") {
        signal?.throwIfAborted();
        const decision = await recall.decide({
          cursor,
          userText: lastUserText(entries),
          maxTokens: 256,
          signal,
        });
        recallInjections = Object.freeze([...(decision.quotes ?? [])]);
        parts.push(...recallInjections);
      }
      const visibleText = parts.join("\n");
      return freezeResult({
        caseId,
        arm,
        seed,
        sourceTraceHash: sourceTraceHash(caseId, entries),
        lockedTestHash: manifest.lockedTestHash,
        benchmarkMajor: manifest.benchmarkMajor,
        clusterId,
        compactor: "pi-native",
        ingress: arm === "A0" ? "pass-through" : "w1",
        recall: arm === "A0" ? "off" : arm === "A1" ? "manual-only" : "proactive",
        visibleText,
        visibleTokens: visibleTokens(visibleText),
        rawHash,
        exactReadHash: arm === "A0" ? null : exactReadHash,
        recallInjections,
      });
    },
  };
}
