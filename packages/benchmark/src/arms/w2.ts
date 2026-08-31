import { domainHash, type RuntimeCursor } from "@pcr/contracts";

import type { CorpusManifest } from "../corpus/index.js";
import { validateOracle, type RawTrace } from "../oracle/index.js";
import type { W1ArmCase, W1ArmCaseCatalog } from "./w1.js";

export type W2ArmId = "B0" | "B1" | "B2";

export interface W2SourceSpan {
  firstEntryId: string;
  lastEntryId: string;
}

export interface W2ArmResult {
  caseId: string;
  arm: W2ArmId;
  seed: number;
  shapedTraceHash: string;
  sourceSpan: W2SourceSpan;
  retainedTailStartId: string;
  lockedTestHash: string;
  benchmarkMajor: number;
  clusterId: string;
  ingress: "w1";
  compactor: "pi-native" | "pcr-deterministic-checkpoint" | "pcr-materialized-checkpoint";
  materializer: "off" | "identity" | "pcr";
  visibleText: string;
  visibleTokens: number;
  tokensBefore: number;
  tokensAfter: number;
  outputHash: string;
}

export type ArmResult = W2ArmResult;

export interface W2ArmRunner {
  run(caseId: string, arm: W2ArmId, seed: number, signal?: AbortSignal): Promise<W2ArmResult>;
}

export interface W2ShapedTrace {
  shapedText: string;
  sourceSpan: W2SourceSpan;
  retainedTailStartId: string;
  tokensBefore: number;
}

export interface W2TraceShaper {
  shape(input: { cursor: RuntimeCursor; trace: RawTrace; signal?: AbortSignal }): Promise<W2ShapedTrace>;
}

export interface W2CompactResult {
  visibleText: string;
  tokensAfter: number;
  outputHash: string;
}

export interface W2NativeCompactor {
  compact(input: {
    cursor: RuntimeCursor;
    shapedText: string;
    sourceSpan: W2SourceSpan;
    retainedTailStartId: string;
    tokensBefore: number;
    seed: number;
    signal?: AbortSignal;
  }): Promise<W2CompactResult>;
}

export interface W2PcrCompactor {
  compact(input: {
    cursor: RuntimeCursor;
    shapedText: string;
    sourceSpan: W2SourceSpan;
    retainedTailStartId: string;
    tokensBefore: number;
    seed: number;
    materializer: "identity" | "pcr";
    signal?: AbortSignal;
  }): Promise<W2CompactResult>;
}

export interface CreateW2ArmRunnerInput {
  corpusId: string;
  manifest: CorpusManifest;
  cursor: RuntimeCursor;
  cases: W1ArmCaseCatalog;
  shaper: W2TraceShaper;
  native: W2NativeCompactor;
  pcr: W2PcrCompactor;
}

export type W2ArmErrorCode =
  | "PCR_W2_DEPENDENCY_MISSING"
  | "PCR_W2_INPUT_INVALID"
  | "PCR_W2_SCOPE_MISMATCH"
  | "PCR_W2_ORACLE_INVALID";

export class W2ArmError extends TypeError {
  readonly code: W2ArmErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: W2ArmErrorCode, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "W2ArmError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

const ARMS = new Set<W2ArmId>(["B0", "B1", "B2"]);
const WORKSPACE_PATTERN = /^ws_[a-f0-9]{40}$/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function failMissing(dependency: string): never {
  throw new W2ArmError("PCR_W2_DEPENDENCY_MISSING", { dependency });
}

function failInput(field: string): never {
  throw new W2ArmError("PCR_W2_INPUT_INVALID", { field });
}

function failScope(details: Record<string, unknown> = {}): never {
  throw new W2ArmError("PCR_W2_SCOPE_MISMATCH", details);
}

function requireNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) failInput(field);
}

function requireFunction(value: unknown, dependency: string): void {
  if (typeof value !== "function") failMissing(dependency);
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

function clusterOf(manifest: CorpusManifest, caseId: string): string | undefined {
  for (const [name, ids] of Object.entries(manifest.clusters)) {
    if (ids.includes(caseId)) return name;
  }
  return undefined;
}

function snapshotShaped(value: W2ShapedTrace): W2ShapedTrace {
  if (!value || typeof value !== "object") failInput("shaper.shape");
  requireNonEmpty(value.shapedText, "shaper.shape.shapedText");
  if (!value.sourceSpan || typeof value.sourceSpan !== "object") failInput("shaper.shape.sourceSpan");
  requireNonEmpty(value.sourceSpan.firstEntryId, "shaper.shape.sourceSpan.firstEntryId");
  requireNonEmpty(value.sourceSpan.lastEntryId, "shaper.shape.sourceSpan.lastEntryId");
  requireNonEmpty(value.retainedTailStartId, "shaper.shape.retainedTailStartId");
  if (typeof value.tokensBefore !== "number" || !Number.isFinite(value.tokensBefore) || value.tokensBefore < 0) {
    failInput("shaper.shape.tokensBefore");
  }
  return {
    shapedText: value.shapedText,
    sourceSpan: { firstEntryId: value.sourceSpan.firstEntryId, lastEntryId: value.sourceSpan.lastEntryId },
    retainedTailStartId: value.retainedTailStartId,
    tokensBefore: value.tokensBefore,
  };
}

function snapshotCompact(value: W2CompactResult, field: string): W2CompactResult {
  if (!value || typeof value !== "object") failInput(field);
  requireNonEmpty(value.visibleText, `${field}.visibleText`);
  if (typeof value.tokensAfter !== "number" || !Number.isFinite(value.tokensAfter) || value.tokensAfter < 0) {
    failInput(`${field}.tokensAfter`);
  }
  requireNonEmpty(value.outputHash, `${field}.outputHash`);
  if (!SHA256_PATTERN.test(value.outputHash)) failInput(`${field}.outputHash`);
  return { visibleText: value.visibleText, tokensAfter: value.tokensAfter, outputHash: value.outputHash };
}

function freezeResult(result: W2ArmResult): W2ArmResult {
  return Object.freeze({
    ...result,
    sourceSpan: Object.freeze({ ...result.sourceSpan }),
  });
}

function visibleTokens(text: string): number {
  return text.split(/\s+/u).filter(Boolean).length;
}

export function createW2ArmRunner(input: CreateW2ArmRunnerInput): W2ArmRunner {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusId !== "string" || input.corpusId.length === 0) failMissing("corpusId");
  const corpusId = input.corpusId;
  const manifest = snapshotManifest(input.manifest);
  const cursor = snapshotCursor(input.cursor, "input.cursor");
  if (!input.cases || typeof input.cases.get !== "function") failMissing("cases");
  if (!input.shaper || typeof input.shaper.shape !== "function") failMissing("shaper");
  if (!input.native || typeof input.native.compact !== "function") failMissing("native");
  if (!input.pcr || typeof input.pcr.compact !== "function") failMissing("pcr");
  requireFunction(input.shaper.shape, "shaper.shape");
  const cases = input.cases;
  const shaper = input.shaper;
  const native = input.native;
  const pcr = input.pcr;
  return {
    async run(caseId: string, arm: W2ArmId, seed: number, signal?: AbortSignal): Promise<W2ArmResult> {
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
      if (!oracle.ok) throw new W2ArmError("PCR_W2_ORACLE_INVALID", { code: oracle.code, itemId: oracle.itemId });
      signal?.throwIfAborted();
      const shaped = snapshotShaped(await shaper.shape({ cursor, trace: record.trace, signal }));
      const shapedTraceHash = domainHash("w2.shaped-trace", {
        caseId,
        shapedText: shaped.shapedText,
        sourceSpan: shaped.sourceSpan,
        retainedTailStartId: shaped.retainedTailStartId,
      });
      signal?.throwIfAborted();
      const compacted = arm === "B0"
        ? snapshotCompact(await native.compact({
          cursor,
          shapedText: shaped.shapedText,
          sourceSpan: shaped.sourceSpan,
          retainedTailStartId: shaped.retainedTailStartId,
          tokensBefore: shaped.tokensBefore,
          seed,
          signal,
        }), "native.compact")
        : snapshotCompact(await pcr.compact({
          cursor,
          shapedText: shaped.shapedText,
          sourceSpan: shaped.sourceSpan,
          retainedTailStartId: shaped.retainedTailStartId,
          tokensBefore: shaped.tokensBefore,
          seed,
          materializer: arm === "B2" ? "pcr" : "identity",
          signal,
        }), "pcr.compact");
      return freezeResult({
        caseId,
        arm,
        seed,
        shapedTraceHash,
        sourceSpan: shaped.sourceSpan,
        retainedTailStartId: shaped.retainedTailStartId,
        lockedTestHash: manifest.lockedTestHash,
        benchmarkMajor: manifest.benchmarkMajor,
        clusterId,
        ingress: "w1",
        compactor: arm === "B0"
          ? "pi-native"
          : arm === "B1"
            ? "pcr-deterministic-checkpoint"
            : "pcr-materialized-checkpoint",
        materializer: arm === "B0" ? "off" : arm === "B1" ? "identity" : "pcr",
        visibleText: compacted.visibleText,
        visibleTokens: visibleTokens(compacted.visibleText),
        tokensBefore: shaped.tokensBefore,
        tokensAfter: compacted.tokensAfter,
        outputHash: compacted.outputHash,
      });
    },
  };
}

export type { W1ArmCase, W1ArmCaseCatalog };
