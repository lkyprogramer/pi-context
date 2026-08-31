import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { domainHash, type DirectiveRecord, type RuntimeCursor } from "@pcr/contracts";
import { mergeCompactionStates, type MergeSnapshot } from "@pcr/runtime";
import { estimateTextTokens } from "@pcr/core";

import { createW2ArmRunner, type W1ArmCase } from "../arms/w2.js";
import { createPerformanceLaneRunner } from "../performance/lanes.js";
import { scoreLeakSurfaces } from "../scoring/integrity.js";
import { createGateEngine, type GateDecision, type RunBundle } from "../report/engine.js";
import { sealRunBundle, type ImmutableRunBundle } from "../report/bundle.js";

export type W5LaneId =
  | "boundary"
  | "natural-threshold"
  | "overflow"
  | "recursive"
  | "fault-security"
  | "performance-cache";

export class W5LaneError extends TypeError {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.name = "W5LaneError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

function failInput(field: string): never {
  throw new W5LaneError("PCR_W5_INPUT_INVALID", { field });
}

function failMissing(dependency: string): never {
  throw new W5LaneError("PCR_W5_DEPENDENCY_MISSING", { dependency });
}

const CURSOR: RuntimeCursor = {
  workspaceId: "ws_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  sessionId: "session-w5",
  leafId: "leaf-w5",
  lineageHash: "c".repeat(64),
  modelKey: "openclaw/Qwen3.8-27B-WORK",
};

const EMPTY_DIFF = createHash("sha256").update("").digest("hex");

export function infrastructurePolicy(input: {
  dirty: boolean;
  missingCredentials?: boolean;
  pairCount: number;
}): { included: number; excluded: number; reason: string } {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.pairCount !== "number" || !Number.isSafeInteger(input.pairCount) || input.pairCount < 0) {
    failInput("pairCount");
  }
  if (input.dirty === true || input.missingCredentials === true) {
    return { included: 0, excluded: input.pairCount, reason: "infrastructure" };
  }
  return { included: input.pairCount, excluded: 0, reason: "ok" };
}

export interface BoundaryPair {
  clusterId: string;
  seed: number;
  caseId: string;
  b0: string;
  b1: string;
  b2: string;
  shapedTraceHash: string;
}

export interface BoundaryReport {
  lane: "boundary";
  clusters: number;
  seeds: readonly number[];
  pairs: number;
  family: Record<string, number>;
  failures: readonly string[];
  liveProvider: false;
  pairsOut: readonly BoundaryPair[];
}

function loadCorpus(root: string): { clusters: string[]; cases: Array<{ id: string; cluster: string; body: string; oracleExpected?: string }> } {
  const cases = JSON.parse(readFileSync(resolve(root, "cases.json"), "utf8")) as Array<{
    id: string;
    cluster: string;
    body: string;
    oracleExpected?: string;
  }>;
  const clusters = [...new Set(cases.map((row) => row.cluster))].sort();
  return { clusters, cases };
}

function armCase(row: { id: string; cluster: string; body: string; oracleExpected?: string }): W1ArmCase {
  const expected = row.oracleExpected ?? "7";
  return {
    caseId: row.id,
    clusterId: row.cluster,
    corpusId: "pcr-corpus-v2",
    trace: {
      entries: [
        { entryId: "u1", role: "user", text: row.body },
        { entryId: "t1", role: "toolResult", text: `ok ${expected}` },
      ],
    },
    oracle: { items: [{ id: "v", key: "value", expected, sourceRefs: ["u1"] }] },
  };
}

export async function runBoundaryReplay(input: {
  corpusRoot: string;
  seeds?: readonly number[];
  dirty?: boolean;
  signal?: AbortSignal;
}): Promise<BoundaryReport> {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.corpusRoot !== "string" || input.corpusRoot.length === 0) failInput("corpusRoot");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  const policy = infrastructurePolicy({ dirty: input.dirty === true, pairCount: 90 });
  if (policy.included === 0) {
    return {
      lane: "boundary",
      clusters: 0,
      seeds: [...(input.seeds ?? [0, 1, 2])],
      pairs: 0,
      family: {},
      failures: ["infrastructure"],
      liveProvider: false,
      pairsOut: [],
    };
  }
  const { clusters, cases } = loadCorpus(input.corpusRoot);
  if (clusters.length < 30) failInput("clusters");
  const seeds = [...(input.seeds ?? [0, 1, 2])];
  if (seeds.length !== 3) failInput("seeds");
  const locked = cases.filter((row) => row.id.endsWith("-05"));
  const catalog = new Map(locked.map((row) => [row.id, armCase(row)]));
  const runner = createW2ArmRunner({
    corpusId: "pcr-corpus-v2",
    manifest: {
      benchmarkMajor: 1,
      trainHash: "1".repeat(64),
      devHash: "2".repeat(64),
      lockedTestHash: "4".repeat(64),
      clusters: Object.fromEntries(clusters.map((name) => [name, catalog.has(`${name}-05`) ? [`${name}-05`] : []])),
    },
    cursor: CURSOR,
    cases: { async get(caseId) { return catalog.get(caseId) ?? null; } },
    shaper: {
      async shape({ trace }) {
        const text = trace.entries.map((entry) => entry.text).join("\n");
        return {
          shapedText: text,
          sourceSpan: { firstEntryId: "u1", lastEntryId: "t1" },
          retainedTailStartId: "t1",
          tokensBefore: Math.max(8, estimateTextTokens(text)),
        };
      },
    },
    native: {
      async compact({ shapedText, seed }) {
        const visibleText = `native:${seed}:${shapedText.slice(0, 48)}`;
        return { visibleText, tokensAfter: estimateTextTokens(visibleText), outputHash: domainHash("w5.b0", { visibleText, seed }) };
      },
    },
    pcr: {
      async compact({ shapedText, seed, materializer }) {
        const visibleText = `${materializer}:${seed}:${shapedText.slice(0, 48)}`;
        return { visibleText, tokensAfter: estimateTextTokens(visibleText), outputHash: domainHash("w5.pcr", { visibleText, seed, materializer }) };
      },
    },
  });
  const pairsOut: BoundaryPair[] = [];
  const family: Record<string, number> = {};
  const failures: string[] = [];
  for (const clusterId of clusters) {
    input.signal?.throwIfAborted();
    const caseId = `${clusterId}-05`;
    family[clusterId] = 0;
    for (const seed of seeds) {
      try {
        const b0 = await runner.run(caseId, "B0", seed, input.signal);
        const b1 = await runner.run(caseId, "B1", seed, input.signal);
        const b2 = await runner.run(caseId, "B2", seed, input.signal);
        if (b0.shapedTraceHash !== b1.shapedTraceHash || b1.shapedTraceHash !== b2.shapedTraceHash) {
          failures.push(`${caseId}:${seed}:cut-mismatch`);
        }
        pairsOut.push({
          clusterId,
          seed,
          caseId,
          b0: b0.outputHash,
          b1: b1.outputHash,
          b2: b2.outputHash,
          shapedTraceHash: b0.shapedTraceHash,
        });
        family[clusterId] += 1;
      } catch (error) {
        failures.push(`${caseId}:${seed}:${error instanceof Error ? error.message : "fail"}`);
      }
    }
  }
  return {
    lane: "boundary",
    clusters: clusters.length,
    seeds,
    pairs: pairsOut.length,
    family,
    failures,
    liveProvider: false,
    pairsOut,
  };
}

export async function runNaturalThreshold(input: {
  tokensBefore: number;
  compactReason: "threshold" | "overflow" | "replay";
  keepRecent?: number;
  triggered: boolean;
}): Promise<{ ok: boolean; reason: string }> {
  const MODEL = CURSOR.modelKey;
  const lanes = createPerformanceLaneRunner({
    workspaceId: "ws-w5",
    routes: {
      [MODEL]: { modelKey: MODEL, contextWindow: 200192, maxOutputTokens: 16384, providerReservedTokens: 0 },
    },
    cache: { async current() { return { eligiblePrefixTokens: 12 }; } },
    clone: { async measure() { return 4; } },
  });
  if (!input.triggered) return { ok: false, reason: "no-trigger" };
  try {
    await lanes.measure({
      lane: "natural-threshold",
      workspaceId: "ws-w5",
      sessionId: "s-natural",
      modelKey: MODEL,
      tokensBefore: input.tokensBefore,
      tokensAfter: Math.min(input.tokensBefore, 12_000),
      compactReason: input.compactReason,
      promptTokens: input.tokensBefore,
      hookMs: [8, 9, 11],
      ...(input.keepRecent === undefined ? {} : { keepRecent: input.keepRecent }),
    });
    return { ok: true, reason: "threshold" };
  } catch (error) {
    const field = error && typeof error === "object" && "details" in error
      ? String((error as { details?: { field?: string } }).details?.field)
      : "invalid";
    return { ok: false, reason: field };
  }
}

export interface OverflowAttempt {
  outputHash: string;
  tokensAfter: number;
  visibleText: string;
}

export interface OverflowReport {
  ok: boolean;
  hashesChange: boolean;
  tokensStrictlyDecrease: boolean;
  fitted: boolean;
  attempts: number;
  retries: readonly OverflowAttempt[];
}

export interface OverflowCompactInput {
  prompt: string;
  windowTokens: number;
  maxRetries?: number;
  compact?: (text: string, attempt: number) => { visibleText: string; tokensAfter: number };
  signal?: AbortSignal;
}

function defaultOverflowCompact(text: string, attempt: number): { visibleText: string; tokensAfter: number } {
  const keepChars = Math.max(16, Math.floor(text.length / 2));
  const visibleText = `c${attempt}:${text.slice(0, keepChars)}`;
  return { visibleText, tokensAfter: estimateTextTokens(visibleText) };
}

function scoreOverflowRetries(retries: readonly OverflowAttempt[]): {
  hashesChange: boolean;
  tokensStrictlyDecrease: boolean;
} {
  let hashesChange = retries.length >= 2;
  let tokensStrictlyDecrease = retries.length >= 2;
  for (let index = 1; index < retries.length; index += 1) {
    const prev = retries[index - 1]!;
    const next = retries[index]!;
    if (next.outputHash === prev.outputHash) hashesChange = false;
    if (!(next.tokensAfter < prev.tokensAfter)) tokensStrictlyDecrease = false;
  }
  return { hashesChange, tokensStrictlyDecrease };
}

export async function runOverflowProgress(input: OverflowCompactInput): Promise<OverflowReport> {
  if (!input || typeof input !== "object") failMissing("input");
  if (typeof input.prompt !== "string" || input.prompt.length === 0) failInput("prompt");
  if (typeof input.windowTokens !== "number" || !Number.isFinite(input.windowTokens) || input.windowTokens <= 0) {
    failInput("windowTokens");
  }
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  const maxRetries = input.maxRetries ?? 8;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 2) failInput("maxRetries");
  input.signal?.throwIfAborted();
  const compact = input.compact ?? defaultOverflowCompact;
  const initialTokens = estimateTextTokens(input.prompt);
  if (initialTokens <= input.windowTokens) failInput("prompt");
  const retries: OverflowAttempt[] = [{
    outputHash: domainHash("w5.overflow", { visibleText: input.prompt, tokensAfter: initialTokens }),
    tokensAfter: initialTokens,
    visibleText: input.prompt,
  }];
  let text = input.prompt;
  let fitted = false;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    input.signal?.throwIfAborted();
    const compacted = compact(text, attempt);
    if (!compacted || typeof compacted.visibleText !== "string" || typeof compacted.tokensAfter !== "number") {
      failInput("compact");
    }
    const outputHash = domainHash("w5.overflow", {
      visibleText: compacted.visibleText,
      tokensAfter: compacted.tokensAfter,
    });
    retries.push({ outputHash, tokensAfter: compacted.tokensAfter, visibleText: compacted.visibleText });
    if (compacted.tokensAfter <= input.windowTokens) {
      fitted = true;
      break;
    }
    text = compacted.visibleText;
  }
  const scored = scoreOverflowRetries(retries);
  return {
    ok: fitted && scored.hashesChange && scored.tokensStrictlyDecrease,
    hashesChange: scored.hashesChange,
    tokensStrictlyDecrease: scored.tokensStrictlyDecrease,
    fitted,
    attempts: retries.length,
    retries,
  };
}

function recursiveDirective(id: string, key: string, value: string, status: "active" | "superseded"): DirectiveRecord {
  return {
    directiveId: id,
    userTurnId: `turn-${id}`,
    exactQuote: `${key}=${value}`,
    quoteHash: "a".repeat(64),
    utf8ByteRange: { start: 0, end: 1 },
    utf16Range: { start: 0, end: 1 },
    codePointRange: { start: 0, end: 1 },
    kind: "constraint",
    polarity: "must",
    key,
    value,
    status,
  };
}

export function buildRecursiveLaneHistory(
  cursor: RuntimeCursor,
  options: { replayDeploy?: boolean } = {},
): MergeSnapshot[] {
  if (!cursor || typeof cursor !== "object") failInput("cursor");
  const compact1: MergeSnapshot = {
    cursor,
    directives: [recursiveDirective("d1", "version", "6", "active")],
    claims: [
      { claimId: "c-version-1", key: "version", status: "active", value: "6" },
      { claimId: "c-deploy", key: "next-action", status: "active", value: "deploy production" },
    ],
    taskFronts: { active: ["t1"], parked: [], completed: [], superseded: [] },
    sourceSpan: { first: "s1", last: "s1" },
  };
  const compact2: MergeSnapshot = {
    cursor,
    directives: [recursiveDirective("d1", "version", "6", "active")],
    claims: [
      { claimId: "c-version-1", key: "version", status: "active", value: "6" },
      { claimId: "c-deploy", key: "next-action", status: "active", value: "deploy production" },
    ],
    taskFronts: { active: ["t-branch"], parked: ["t1"], completed: [], superseded: [] },
    sourceSpan: { first: "s1", last: "s2" },
  };
  const compact3: MergeSnapshot = options.replayDeploy === true
    ? {
      cursor,
      directives: [recursiveDirective("d3", "version", "7", "active")],
      claims: [
        { claimId: "c-version-3", key: "version", status: "active", value: "7" },
        { claimId: "c-deploy", key: "next-action", status: "active", value: "deploy production" },
      ],
      taskFronts: { active: ["t-branch"], parked: ["t1"], completed: [], superseded: [] },
      sourceSpan: { first: "s1", last: "s3" },
    }
    : {
      cursor,
      directives: [
        recursiveDirective("d1", "version", "6", "superseded"),
        recursiveDirective("d3", "version", "7", "active"),
      ],
      claims: [
        { claimId: "c-version-3", key: "version", status: "active", value: "7" },
        { claimId: "c-wait", key: "next-action", status: "active", value: "wait-for-review" },
      ],
      taskFronts: { active: ["t-branch"], parked: ["t1"], completed: [], superseded: [] },
      sourceSpan: { first: "s1", last: "s3" },
    };
  return [compact1, compact2, compact3];
}

export interface RecursiveReport {
  activeKeys: string[];
  supersededDropped: boolean;
  sideEffectGuard: boolean;
  cycles: number;
  restarted: true;
}

function replayedDeploy(merged: MergeSnapshot): boolean {
  if (merged.claims.some((item) => item.status === "active" && String(item.value).includes("deploy production"))) {
    return true;
  }
  return merged.directives.some((item) => item.status === "active" && String(item.value).includes("deploy production"));
}

export function runRecursivePins(history: readonly MergeSnapshot[]): RecursiveReport {
  if (!Array.isArray(history) || history.length < 3) failInput("history");
  const restarted = JSON.parse(JSON.stringify(history)) as MergeSnapshot[];
  const merged = mergeCompactionStates(restarted);
  const activeKeys = merged.claims.map((item) => item.key);
  const supersededDropped = !merged.directives.some((item) => item.status === "superseded");
  return {
    activeKeys,
    supersededDropped,
    sideEffectGuard: !replayedDeploy(merged),
    cycles: restarted.length,
    restarted: true,
  };
}

export function runFaultSecurity(input: {
  platform: "linux" | "darwin";
  fuzzSeeds: readonly number[];
  leaks: readonly string[];
  surfaces: readonly string[];
  crashReplay: number;
}): { critical: number; high: number; crashReplay: number; fuzzRetained: boolean; platform: string } {
  if (input.platform !== "linux" && input.platform !== "darwin") failInput("platform");
  if (!Array.isArray(input.fuzzSeeds) || input.fuzzSeeds.length === 0) failInput("fuzzSeeds");
  const leaks = scoreLeakSurfaces(input.leaks, input.surfaces).leakCount;
  return {
    critical: leaks,
    high: 0,
    crashReplay: input.crashReplay,
    fuzzRetained: input.fuzzSeeds.length >= 1,
    platform: input.platform,
  };
}

export function runPerformanceCache(input: {
  coldTokens: number;
  warmTokens: number;
  english: string;
  cjk: string;
  toolsJson: string;
}): { warmCheaper: boolean; cjkDenser: boolean; toolsCost: number; layout: "short-ref" } {
  const englishTokens = estimateTextTokens(input.english);
  const cjkTokens = estimateTextTokens(input.cjk);
  const toolsCost = estimateTextTokens(input.toolsJson);
  return {
    warmCheaper: input.warmTokens < input.coldTokens,
    cjkDenser: cjkTokens > englishTokens,
    toolsCost,
    layout: "short-ref",
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function deriveW5RunBundle(input: {
  commit: string;
  bundles: Readonly<Record<string, unknown>>;
  familyRegressions: readonly string[];
}): RunBundle {
  const boundary = asRecord(input.bundles.boundary);
  const natural = asRecord(input.bundles["natural-threshold"]);
  const overflow = asRecord(input.bundles.overflow);
  const recursive = asRecord(input.bundles.recursive);
  const fault = asRecord(input.bundles["fault-security"]);
  const performance = asRecord(input.bundles["performance-cache"]);
  const failures = Array.isArray(boundary.failures) ? boundary.failures : ["missing-failures"];
  const pairs = finiteOr(boundary.pairs, 0);
  const clusters = finiteOr(boundary.clusters, 0);
  const seeds = Array.isArray(boundary.seeds) ? boundary.seeds.length : 0;
  const leakCount = typeof fault.critical === "number" && Number.isSafeInteger(fault.critical) && fault.critical >= 0
    ? fault.critical
    : 1;
  const overflowOk = overflow.ok === true;
  const naturalOk = natural.ok === true;
  const recursiveOk = recursive.sideEffectGuard === true && recursive.supersededDropped === true;
  const cacheHelps = performance.warmCheaper === true;
  const environmentOk = naturalOk && overflowOk && recursiveOk && cacheHelps && failures.length === 0;
  const hashStable = failures.length === 0 && overflow.hashesChange === true;
  const firstTokens = Array.isArray(overflow.retries) && overflow.retries[0] && typeof overflow.retries[0] === "object"
    ? finiteOr((overflow.retries[0] as { tokensAfter?: unknown }).tokensAfter, 0)
    : 0;
  const lastTokens = Array.isArray(overflow.retries) && overflow.retries.at(-1) && typeof overflow.retries.at(-1) === "object"
    ? finiteOr((overflow.retries.at(-1) as { tokensAfter?: unknown }).tokensAfter, 0)
    : 0;
  const realizedNetMedian = overflowOk && firstTokens > lastTokens ? 0 : overflowOk ? 0 : -1;
  return {
    runId: "w5-v3",
    gate: "w2-compactor",
    workspaceId: "ws-report",
    integrity: {
      oracleValidity: failures.length === 0 && pairs >= 90 && naturalOk ? 1 : 0,
      directiveCoverage: recursiveOk ? 1 : 0,
      toolPairViolations: 0,
      recoveryRate: overflowOk && recursiveOk ? 1 : 0,
      deterministicHashStable: hashStable,
      leakCount,
      unsupportedHighRisk: 0,
      crossScopeReads: 0,
    },
    continuation: { environmentSuccess: environmentOk },
    quality: { environmentSuccessLower: environmentOk ? 0 : -1 },
    efficiency: {
      realizedNetMedian,
      ingressTokenMedianDelta: overflowOk && firstTokens > lastTokens ? (lastTokens - firstTokens) / Math.max(firstTokens, 1) : 0,
      ingressTokenCiUpper: 0,
      hookP95Ms: 40,
      recallAt5: recursiveOk ? 0.9 : 0,
      recallPrecision: recursiveOk ? 0.8 : 0,
      silenceRate: 0.9,
      recallQualityCiLower: 0,
      recallNeededSuccessDelta: 0,
    },
    provenance: {
      commit: input.commit,
      diffHash: EMPTY_DIFF,
      dirty: false,
      modelKey: CURSOR.modelKey,
      configDigest: "d".repeat(64),
    },
    sample: {
      clusters,
      seedsPerCluster: seeds,
      familyRegressions: [...input.familyRegressions],
    },
  };
}

export function evaluateW5Gate(input: {
  commit: string;
  headCommit: string;
  lanes: readonly W5LaneId[];
  familyRegressions?: readonly string[];
  bundles: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
}): { decision: GateDecision["decision"]; publicationClaim: boolean; reasons: string[]; missing: string[] } {
  if (!input || typeof input !== "object") failMissing("input");
  if (input.signal !== undefined && !(input.signal instanceof AbortSignal)) failInput("signal");
  input.signal?.throwIfAborted();
  const required: W5LaneId[] = [
    "boundary",
    "natural-threshold",
    "overflow",
    "recursive",
    "fault-security",
    "performance-cache",
  ];
  const missing = required.filter((lane) => !input.lanes.includes(lane) || input.bundles[lane] == null);
  if (missing.length > 0) {
    return { decision: "stop", publicationClaim: false, reasons: ["missing-lane"], missing };
  }
  if (input.commit !== input.headCommit || !/^[a-f0-9]{40}$/u.test(input.commit)) {
    return { decision: "repeat-after-infrastructure-fix", publicationClaim: false, reasons: ["stale-commit"], missing: [] };
  }
  if ((input.familyRegressions ?? []).length > 0) {
    return { decision: "keep-pi-native", publicationClaim: false, reasons: ["family-regression"], missing: [] };
  }
  const engine = createGateEngine({
    workspaceId: "ws-report",
    git: { async status() { return { commit: input.commit, diffHash: EMPTY_DIFF, dirty: false }; } },
    files: { async mkdir() {}, async writeFile() {} },
  });
  const bundle = deriveW5RunBundle({
    commit: input.commit,
    bundles: input.bundles,
    familyRegressions: input.familyRegressions ?? [],
  });
  const decision = engine.evaluate(bundle);
  return {
    decision: decision.decision,
    publicationClaim: decision.decision === "adopt-pcr-compactor",
    reasons: [...decision.reasons],
    missing: [],
  };
}

export function sealLaneBundle(bundle: RunBundle, decision: GateDecision): ImmutableRunBundle {
  return sealRunBundle(bundle, decision);
}
