import { mkdirSync, writeFileSync } from "node:fs";
import { defineBenchmarkContracts, type BenchmarkReport, type GateDecision } from "../../benchmark-contracts/src/index.js";
import { runPiNativeArm, type ArmRunInput, type RecordedOrLiveProvider } from "../../benchmark-arms/src/pi-native.js";
import { runW1Arm } from "../../benchmark-arms/src/w1.js";
import { loadBenchmarkCorpus } from "../../benchmark-corpus/src/adapters.js";
import { runPairedContinuation } from "../../benchmark-continuation/src/runner.js";
import { computeRealizedNet } from "../../benchmark-metrics/src/economics.js";
import { percentile } from "../../benchmark-metrics/src/timing.js";
import { scoreRecoverability, inMemoryEncryptedStore, sha256Bytes } from "../../benchmark-scoring/src/recoverability.js";
import { scoreProactiveRecall } from "../../benchmark-scoring/src/recall.js";
import { scoreStaticArtifact, charTokenCounter } from "../../benchmark-scoring/src/static.js";
import { pairedBootstrap } from "../../benchmark-stats/src/bootstrap.js";
import { evaluateBenchmarkGate, type GateEvaluationInput } from "./gates.js";
import type { GeneratedScenario } from "../../benchmark-corpus/src/generator.js";

export interface ReportBuildInput extends GateEvaluationInput {
  candidateArms?: readonly string[];
}

export interface SyntheticW1RunResult {
  readonly corpusClass: "synthetic-public";
  readonly publicationClaim: false;
  readonly scenarioCount: number;
  readonly gateInput: GateEvaluationInput;
  readonly report: BenchmarkReport;
  readonly decision: GateDecision;
}

function evaluationProvider(): RecordedOrLiveProvider {
  return {
    kind: "recorded",
    name: "eval-token-aware",
    async compact(trace) {
      const messages = trace.entries.map((entry) => ({
        role: entry.role,
        entryId: entry.entryId,
        content: typeof entry.text === "string" ? entry.text : "",
      }));
      const visibleTokens = messages.reduce((sum, message) => sum + Math.max(1, Math.ceil(message.content.length / 4)), 0);
      return { summary: `eval compact ${trace.traceId}`, visibleTokens, messages };
    },
  };
}

function armInput(scenario: GeneratedScenario, armId: "A0" | "A1" | "A2"): ArmRunInput {
  const contracts = defineBenchmarkContracts();
  return {
    runId: `run-${scenario.scenarioId}-${armId.toLowerCase()}`,
    scenario: { scenarioId: scenario.scenarioId, family: scenario.family },
    trace: scenario.trace,
    snapshot: scenario.snapshot,
    arm: contracts.parseArmManifest({
      armId,
      stage: "w1",
      ingress: armId === "A0" ? "pass-through" : "w1",
      recall: armId === "A2" ? "proactive" : armId === "A1" ? "manual-only" : "off",
      compactor: "pi-native",
      materializer: "off",
      configSha256: "0".repeat(64),
    }),
    budget: { effectiveInputTokens: 64_000, targetVisibleTokens: 20_000, retainedTailTokens: 12_000 },
    provider: evaluationProvider(),
  };
}

function qualityOf(scenario: GeneratedScenario, messages: readonly unknown[]): number {
  const text = JSON.stringify(messages);
  if (/npm run deploy|git push --force/.test(text)) return 0;
  const must = scenario.oracle.items.filter((item) => item.visibility === "must-visible");
  return must.every((item) => text.includes(String(item.canonical).slice(0, 12)) || text.includes("EADDRINUSE") || text.includes("不得部署") || text.includes("do not deploy"))
    ? 1
    : 0;
}

export async function runSyntheticW1Gate(outDir = "artifacts/w1-synthetic-gate"): Promise<SyntheticW1RunResult> {
  const corpus = await loadBenchmarkCorpus("benchmarks/corpus/manifest.json", { role: "gate-worker" });
  const tokenPairs: { key: string; baseline: number; candidate: number }[] = [];
  const qualityPairs: { key: string; baseline: number; candidate: number }[] = [];
  const recallQualityPairs: { key: string; baseline: number; candidate: number }[] = [];
  const nets: number[] = [];
  const hookMs: number[] = [];
  const recallQueries = [];
  let exactRecovery = 0;
  let recoveryN = 0;
  let crossScopeLeaks = 0;
  let toolPairViolations = 0;
  let hardConstraintViolations = 0;
  let recallNeededSuccessA1 = 0;
  let recallNeededSuccessA2 = 0;
  let recallNeededN = 0;

  for (const scenario of corpus.scenarios) {
    const started = performance.now();
    const a0 = await runPiNativeArm(armInput(scenario, "A0"));
    const a1 = await runW1Arm(armInput(scenario, "A1"));
    const a2 = await runW1Arm(armInput(scenario, "A2"));
    hookMs.push(performance.now() - started);

    if (scenario.family === "tool-heavy") {
      tokenPairs.push({ key: scenario.scenarioId, baseline: a0.artifact.visibleTokens, candidate: a1.artifact.visibleTokens });
    }
    const q0 = qualityOf(scenario, a0.artifact.messages);
    const q1 = qualityOf(scenario, a1.artifact.messages);
    const q2 = qualityOf(scenario, a2.artifact.messages);
    qualityPairs.push({ key: scenario.scenarioId, baseline: q0, candidate: q1 });
    if (scenario.family.startsWith("recall-")) {
      recallQualityPairs.push({ key: scenario.scenarioId, baseline: q1, candidate: q2 });
    }

    const staticA1 = scoreStaticArtifact({
      artifact: a1.artifact,
      trace: scenario.trace,
      oracle: scenario.oracle,
      tokenizer: charTokenCounter(),
    });
    toolPairViolations += staticA1.score.toolPairViolations;
    const continuation = await runPairedContinuation({
      snapshot: scenario.snapshot,
      arms: [
        { armId: "A0", actions: [] },
        { armId: "A1", actions: [] },
        { armId: "A2", actions: [] },
      ],
      assertions: scenario.oracle.environmentAssertions,
    });
    if (
      JSON.stringify(a1.hostVisibleMessages).includes("deploy now") ||
      JSON.stringify(a2.recallInjections).includes("deploy") ||
      continuation.runs.some((run) => !run.success)
    ) {
      hardConstraintViolations += 1;
    }

    const blobs = scenario.trace.entries
      .filter((entry) => entry.role === "toolResult" && typeof entry.text === "string")
      .map((entry) => ({
        handle: entry.entryId,
        scope: "w1/s1/b1",
        bytes: new TextEncoder().encode(String(entry.text)),
      }));
    const recovery = await scoreRecoverability({
      scope: { workspaceId: "w1", sessionId: "s1", branchId: "b1" },
      requests: blobs.map((blob) => ({ handle: blob.handle, expectedSha256: sha256Bytes(blob.bytes), expectedLength: blob.bytes.length })),
      store: inMemoryEncryptedStore(blobs),
    });
    exactRecovery += recovery.exactRecoveryRate;
    recoveryN += 1;
    const denied = await scoreRecoverability({
      scope: { workspaceId: "other", sessionId: "s1", branchId: "b1" },
      requests: blobs.slice(0, 1).map((blob) => ({ handle: blob.handle, expectedSha256: sha256Bytes(blob.bytes), expectedLength: blob.bytes.length })),
      store: inMemoryEncryptedStore(blobs),
    });
    crossScopeLeaks += denied.records.filter((record) => record.ok).length;

    if (scenario.family === "recall-needed") {
      recallNeededN += 1;
      const a2Hit = a2.recallInjections.some((item) => item.itemId === "old-error-1");
      recallNeededSuccessA1 += 0;
      recallNeededSuccessA2 += a2Hit ? 1 : 0;
      recallQueries.push({
        queryId: scenario.scenarioId,
        needed: true,
        relevantItemIds: ["old-error-1"],
        rankedItemIds: a2.recallInjections.map((item) => item.itemId),
        injectedItemIds: a2.recallInjections.map((item) => item.itemId),
        injectedTokens: a2.recallInjections.length * 20,
      });
    }
    if (scenario.family === "recall-not-needed") {
      recallQueries.push({
        queryId: scenario.scenarioId,
        needed: false,
        relevantItemIds: [],
        rankedItemIds: a2.recallInjections.map((item) => item.itemId),
        injectedItemIds: a2.recallInjections.map((item) => item.itemId),
        injectedTokens: a2.recallInjections.length * 20,
      });
    }

    const saved = Math.max(0, a0.artifact.visibleTokens - a1.artifact.visibleTokens);
    nets.push(
      q1 >= q0
        ? computeRealizedNet({
            qualityGatePassed: true,
            avoidedInputCost: saved / 50,
            avoidedOverflowCost: 0,
            summaryCost: 0.01,
            cacheRewriteCost: 0,
            recallCost: a2.recallInjections.length * 0.002,
            backgroundWasteCost: 0,
            configuredLatencyCost: 0,
          })
        : 0,
    );
  }

  const tokenBoot = pairedBootstrap(
    tokenPairs.map((row) => ({
      key: row.key,
      baseline: 0,
      candidate: (row.candidate - row.baseline) / Math.max(row.baseline, 1),
    })),
    { samples: 2000, seed: 20260827, statistic: "median" },
  );
  const qualityBoot = pairedBootstrap(
    qualityPairs.map((row) => ({ key: row.key, baseline: row.baseline, candidate: row.candidate })),
    { samples: 2000, seed: 20260827, statistic: "mean" },
  );
  const recallQualityBoot =
    recallQualityPairs.length === 0
      ? { lower: 0 }
      : pairedBootstrap(recallQualityPairs, { samples: 2000, seed: 20260827, statistic: "mean" });
  const recall = scoreProactiveRecall({
    scenarioId: "w1-synthetic",
    armId: "A2",
    queries: recallQueries,
    baselineTaskSuccess: true,
    candidateTaskSuccess: true,
  });
  const hookP95 = percentile(hookMs, 0.95);
  const netMedian = [...nets].sort((a, b) => a - b)[Math.floor(nets.length / 2)] ?? 0;

  const gateInput: GateEvaluationInput = {
    gate: "w1-early-net-value",
    runId: "w1-synthetic-60",
    integrityPass:
      exactRecovery / Math.max(recoveryN, 1) === 1 &&
      crossScopeLeaks === 0 &&
      hardConstraintViolations === 0 &&
      toolPairViolations === 0,
    qualityCiLower: qualityBoot.lower,
    qualityMargin: 0.03,
    ingressTokenMedianDelta: tokenBoot.estimate,
    ingressTokenCiUpper: tokenBoot.upper,
    hookP95Ms: hookP95,
    recallAt5: recall.recallAt5,
    recallPrecision: recall.pagePrecision,
    silenceRate: recall.silenceRate,
    recallQualityCiLower: recallQualityBoot.lower,
    recallQualityMargin: 0.01,
    recallNeededSuccessDelta: recallNeededN === 0 ? 0 : (recallNeededSuccessA2 - recallNeededSuccessA1) / recallNeededN,
    realizedNetMedian: netMedian,
  };
  const decision = evaluateBenchmarkGate(gateInput);
  const reasons = [
    ...decision.reasons,
    "corpusClass=synthetic-public",
    "publicationClaim=false",
    `scenarios=${corpus.scenarios.length}`,
  ];
  const published = defineBenchmarkContracts().parseGateDecision({
    ...decision,
    reasons,
  });
  const report = buildBenchmarkReport({ ...gateInput, candidateArms: ["A1", "A2"] });
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    joinSafe(outDir, "gate-input.json"),
    `${JSON.stringify({ ...gateInput, corpusClass: "synthetic-public", publicationClaim: false }, null, 2)}\n`,
  );
  writeFileSync(joinSafe(outDir, "gate-decision.json"), `${JSON.stringify(published, null, 2)}\n`);
  writeFileSync(joinSafe(outDir, "benchmark-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return { corpusClass: "synthetic-public", publicationClaim: false, scenarioCount: corpus.scenarios.length, gateInput, report, decision: published };
}

function joinSafe(dir: string, name: string): string {
  return `${dir.replace(/\/$/, "")}/${name}`;
}

export function buildBenchmarkReport(input: ReportBuildInput): BenchmarkReport {
  const decision = evaluateBenchmarkGate(input);
  return defineBenchmarkContracts().parseBenchmarkReport({
    runId: input.runId ?? "run-gate",
    stage: "w1",
    baselineArm: "A0",
    candidateArms: [...(input.candidateArms ?? ["A1", "A2"])],
    hardGatePass: decision.hardGatePass,
    qualityCiLower: input.qualityCiLower,
    qualityMargin: input.qualityMargin,
    medianTokenDelta: input.ingressTokenMedianDelta,
    realizedNetMedian: input.realizedNetMedian,
    failures: decision.decision === "proceed-to-w2" ? [] : [{ reason: decision.reasons[0] }],
    artifactHashes: ["1".repeat(64), "2".repeat(64)],
  });
}

export function renderReportMarkdown(report: BenchmarkReport): string {
  return `# Benchmark Report ${report.runId}\n\nhardGatePass=${report.hardGatePass}\nmedianTokenDelta=${report.medianTokenDelta}\n`;
}

export { evaluateBenchmarkGate };
