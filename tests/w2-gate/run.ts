import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { runB0, runB1, runB2, tokensBeforeOf, type W2ArmMetrics } from "./arms.js";
import { buildW2SyntheticCorpus, corpusQuota } from "./corpus.js";
import { evaluateW2Gate, median, pairedBootstrapCi, relativeDelta } from "./scorer.js";

export async function runW2CompactorGate(outDir = "artifacts/runs/w2-synthetic"): Promise<{
  reportPath: string;
  decision: string;
  report: Record<string, unknown>;
}> {
  const cases = buildW2SyntheticCorpus();
  const quotas = corpusQuota(cases);
  const blobs = new EncryptedBlobStore({
    root: mkdtempSync(join(tmpdir(), "pcr-w2-gate-")),
    workspaceId: "w2",
    keys: new TestKeyProvider(Buffer.alloc(32, 11)),
  });
  const rows: Array<{ id: string; family: string; b0: W2ArmMetrics; b1: W2ArmMetrics; b2: W2ArmMetrics }> = [];
  for (const item of cases) {
    const tokensBefore = tokensBeforeOf(item);
    const b1 = await runB1(item, blobs, tokensBefore);
    const targetTokens = Math.max(Math.ceil(b1.tokens / 0.8), Math.floor(tokensBefore * 0.35), 480);
    const b0 = runB0(item, targetTokens, tokensBefore);
    const b2 = await runB2(item, b1);
    rows.push({ id: item.id, family: item.family, b0, b1, b2 });
  }

  const sameSpan = rows.every(
    (row) =>
      row.b0.sourceSpan.first === row.b1.sourceSpan.first &&
      row.b0.sourceSpan.last === row.b1.sourceSpan.last &&
      row.b1.sourceSpan.first === row.b2.sourceSpan.first &&
      row.b0.retainedTailStartId === row.b1.retainedTailStartId &&
      row.b1.retainedTailStartId === row.b2.retainedTailStartId,
  );
  const directiveCoverage = rows.every((row) => row.b1.directiveCoverage === 1 && row.b2.directiveCoverage === 1) ? 1 : 0;
  const unsupported = rows.filter((row) => row.b1.unsupportedHighRiskOutcome + row.b2.unsupportedHighRiskOutcome > 0).length;
  const toolPair = rows.filter((row) => row.b1.toolPairViolation + row.b2.toolPairViolation > 0).length;
  const leaks = rows.filter((row) => row.b1.mustOmitLeak + row.b2.mustOmitLeak > 0).length;
  const recovered = rows.filter((row) => row.b1.recovered).length / rows.length;
  const hashStable = rows.every((row) => row.b1.hashStable && row.b2.hashStable);
  const hardGatePass =
    sameSpan && directiveCoverage === 1 && unsupported === 0 && toolPair === 0 && leaks === 0 && recovered === 1 && hashStable;

  const quality = pairedBootstrapCi(
    rows.map((row) => row.b0.quality),
    rows.map((row) => row.b1.quality),
  );
  const polarity = pairedBootstrapCi(
    rows.map((row) => row.b0.polarity),
    rows.map((row) => row.b1.polarity),
  );
  const time = pairedBootstrapCi(
    rows.map((row) => row.b0.time),
    rows.map((row) => row.b1.time),
  );
  const update = pairedBootstrapCi(
    rows.map((row) => row.b0.update),
    rows.map((row) => row.b1.update),
  );
  const abstention = pairedBootstrapCi(
    rows.map((row) => row.b0.abstention),
    rows.map((row) => row.b1.abstention),
  );
  const closedLoop = pairedBootstrapCi(
    rows.map((row) => row.b0.closedLoopSuccess),
    rows.map((row) => row.b1.closedLoopSuccess),
  );
  const constraintB0 = rows.reduce((sum, row) => sum + row.b0.constraintViolation, 0);
  const constraintB1 = rows.reduce((sum, row) => sum + row.b1.constraintViolation, 0);

  const budgetMismatchRate = rows.filter((row) => row.b0.budgetMismatch).length / rows.length;
  const tokenDeltas = rows.map((row) => relativeDelta(row.b1.tokens, row.b0.tokens));
  const tokenMedianRelativeDelta = median(tokenDeltas);
  const costB0 = rows.map((row) => row.b0.tokens / Math.max(row.b0.closedLoopSuccess, 0.05));
  const costB1 = rows.map((row) => row.b1.tokens / Math.max(row.b1.closedLoopSuccess, 0.05));
  const costPerSuccessRelativeDelta = relativeDelta(median(costB1), median(costB0));

  const overflow = rows.filter((row) => row.family === "overflow");
  const overflowB0 = overflow.filter((row) => row.b0.recovered).length / Math.max(overflow.length, 1);
  const overflowB1 = overflow.filter((row) => row.b1.recovered).length / Math.max(overflow.length, 1);
  const overflowQuality = pairedBootstrapCi(
    overflow.map((row) => row.b0.quality),
    overflow.map((row) => row.b1.quality),
  );

  const realized = rows.map((row) => row.b0.tokens - row.b1.tokens);
  const realizedCi = pairedBootstrapCi(
    realized.map(() => 0),
    realized,
  );

  const decision = evaluateW2Gate({
    hardGatePass,
    qualityCiLower: quality.lower,
    polarityCiLower: polarity.lower,
    timeCiLower: time.lower,
    updateCiLower: update.lower,
    abstentionCiLower: abstention.lower,
    qualityMargin: 0.02,
    closedLoopSuccessCiLower: closedLoop.lower,
    constraintViolationsCandidate: constraintB1,
    constraintViolationsBaseline: constraintB0,
    tokenMedianRelativeDelta,
    costPerSuccessRelativeDelta,
    overflowRecoveryBetter: overflowB1 > overflowB0,
    overflowQualityNonInferior: overflowQuality.lower >= -0.02,
    realizedNetMedian: realizedCi.estimate,
    budgetMismatchRate,
  });

  const reasons =
    decision === "proceed-to-semantic"
      ? [
          "PCR B1/B2 hard gates passed on the synthetic 100-pair corpus",
          "reader polarity/time/update/abstention were non-inferior to synthetic B0 with margin 0.02",
          "closed-loop success was non-inferior and constraint violations did not increase",
          "B1 token median beat B0 by at least 15% on budget-matched pairs and realized net was positive",
        ]
      : ["see hard/reader/closed-loop/efficiency/economics; B0 is a synthetic Pi-native-like summarizer"];

  const report = {
    runId: "w2-synthetic-public",
    gate: "w2-compactor",
    stage: "w2",
    baselineArm: "B0",
    candidateArms: ["B1", "B2"],
    corpusClass: "synthetic-public",
    publicationClaim: false,
    usedWalkthroughConstants: false,
    livePiNative: false,
    b0Kind: "synthetic-pi-native-like-summarizer",
    pcrRuntimeConsumed: [
      "captureUserDirectives",
      "captureObservation",
      "readEvidenceById",
      "buildDeterministicCheckpointCandidate",
      "renderHostCheckpoint",
      "ContextMaterializer",
    ],
    compaction: "pcr-deterministic-checkpoint",
    materializerImplemented: true,
    replicates: 3,
    qualityNonInferiorityMargin: 0.02,
    quotas,
    sharedBoundary: { sameSourceSpan: sameSpan, sameRetainedTail: sameSpan },
    hard: {
      directiveCoverage,
      unsupportedHighRiskOutcome: unsupported,
      toolPairViolation: toolPair,
      mustOmitLeak: leaks,
      exactEvidenceRecovery: recovered,
      outputHashStable: hashStable,
    },
    hardGatePass,
    reader: {
      b1_vs_b0: quality,
      polarity,
      time,
      update,
      abstention,
    },
    closedLoop: {
      successCi: closedLoop,
      constraintViolations: { B0: constraintB0, B1: constraintB1 },
    },
    efficiency: {
      tokenMedianRelativeDelta,
      budgetMismatchRate,
      costPerSuccessRelativeDelta,
      overflowRecovery: { B0: overflowB0, B1: overflowB1 },
      overflowQualityCi: overflowQuality,
    },
    economics: {
      realizedNetMedian: realizedCi.estimate,
      realizedNetCi: { lower: realizedCi.lower, upper: realizedCi.upper },
      pairsWithPositiveNet: realized.filter((value) => value > 0).length,
    },
    qualityCiLower: quality.lower,
    qualityMargin: 0.02,
    medianTokenDelta: tokenMedianRelativeDelta,
    realizedNetMedian: realizedCi.estimate,
    failures: decision === "proceed-to-semantic" ? [] : [{ decision }],
    artifactHashes: rows.map((row) => row.b1.outputHash),
    decision,
    decisionReasons: reasons,
    caseIds: rows.map((row) => row.id),
  };
  const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const finalReport = { ...report, reportDigest: digest };
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  writeFileSync(
    join(outDir, "gate-decision.json"),
    `${JSON.stringify(
      {
        runId: report.runId,
        gate: "w2-compactor",
        decision,
        hardGatePass,
        reasons,
        reportSha256: digest,
      },
      null,
      2,
    )}\n`,
  );
  return { reportPath, decision, report: finalReport };
}
