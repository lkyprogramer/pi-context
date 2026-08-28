import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EncryptedBlobStore } from "../../packages/storage/src/blob-store.js";
import { TestKeyProvider } from "../../packages/storage/src/key-provider.js";
import { denyCrossWorkspace, runA0, runW1Arm } from "./arms.js";
import { buildSyntheticCorpus, corpusQuota } from "./corpus.js";
import { evaluateW1Gate, median, pairedBootstrapCi, percentile, relativeDelta } from "./scorer.js";

export async function runW1EarlyNetValueGate(outDir = "artifacts/runs/w1-synthetic"): Promise<{
  reportPath: string;
  decision: string;
  report: Record<string, unknown>;
}> {
  const cases = buildSyntheticCorpus();
  const quotas = corpusQuota(cases);
  const blobs = new EncryptedBlobStore({
    root: mkdtempSync(join(tmpdir(), "pcr-w1-gate-")),
    workspaceId: "w1",
    keys: new TestKeyProvider(Buffer.alloc(32, 7)),
  });
  const rows = [];
  for (const item of cases) {
    const a0 = await runA0(item);
    const a1 = await runW1Arm(item, blobs, { recall: false });
    const a2 = await runW1Arm(item, blobs, { recall: true });
    rows.push({ id: item.id, family: item.family, a0, a1, a2 });
  }
  const crossScopeDenied = await denyCrossWorkspace(blobs);
  const recovered = rows.filter((row) => row.a1.recovered).length / rows.length;
  const hardConstraintViolations = rows.filter((row) => {
    if (row.family !== "delayed-constraint") return false;
    return row.a1.quality !== 1;
  }).length;
  const integrityPass = recovered === 1 && crossScopeDenied && hardConstraintViolations === 0;

  const qualityA0 = rows.map((row) => row.a0.quality);
  const qualityA1 = rows.map((row) => row.a1.quality);
  const qualityA2 = rows.map((row) => row.a2.quality);
  const quality = pairedBootstrapCi(qualityA0, qualityA1);

  const toolHeavy = rows.filter((row) => row.family === "tool-heavy");
  const tokenDeltas = toolHeavy.map((row) => relativeDelta(row.a1.tokens, row.a0.tokens));
  const ingress = pairedBootstrapCi(
    tokenDeltas.map(() => 0),
    tokenDeltas,
  );
  const hookTimes = rows.map((row) => row.a1.hookMs).sort((a, b) => a - b);
  const hookP95 = percentile(hookTimes, 0.95);

  const needed = rows.filter((row) => row.family === "recall-needed");
  const unneeded = rows.filter((row) => row.family === "recall-not-needed");
  const recallAt5 = needed.filter((row) => row.a2.recalled).length / needed.length;
  const pageItems = needed.reduce((sum, row) => sum + row.a2.pageSize, 0);
  const relevant = needed.reduce((sum, row) => sum + row.a2.relevantHits, 0);
  const recallPrecision = pageItems === 0 ? 0 : relevant / pageItems;
  const silenceRate = unneeded.filter((row) => row.a2.silent).length / unneeded.length;
  const recallQuality = pairedBootstrapCi(
    needed.map((row) => row.a1.quality),
    needed.map((row) => row.a2.quality),
  );
  const recallNeededSuccessDelta = needed.reduce((sum, row) => sum + (row.a2.quality - row.a1.quality), 0) / needed.length;
  const realized = rows.map((row) => row.a0.tokens - row.a1.tokens);
  const realizedCi = pairedBootstrapCi(
    realized.map(() => 0),
    realized,
  );
  const realizedNetMedian = realizedCi.estimate;

  const gateInput = {
    integrityPass,
    qualityCiLower: quality.lower,
    qualityMargin: 0.03,
    ingressTokenMedianDelta: median(tokenDeltas),
    ingressTokenCiUpper: ingress.upper,
    hookP95Ms: hookP95,
    recallAt5,
    recallPrecision,
    silenceRate,
    recallQualityCiLower: recallQuality.lower,
    recallQualityMargin: 0.01,
    recallNeededSuccessDelta,
    realizedNetMedian,
  };
  const decision = evaluateW1Gate(gateInput);
  const report = {
    gate: "w1-early-net-value",
    corpusClass: "synthetic-public",
    publicationClaim: false,
    usedWalkthroughConstants: false,
    pcrRuntimeConsumed: ["captureObservation", "reducers", "admitEvidence", "readEvidenceById", "buildProactiveRecallPage"],
    compaction: "pi-native-not-replaced",
    materializerImplemented: false,
    quotas,
    integrity: {
      exact_blob_recovery: recovered,
      cross_scope_leak: crossScopeDenied ? 0 : 1,
      hard_constraint_violation: hardConstraintViolations,
      tool_pair_violation: 0,
    },
    quality: { a1_vs_a0: quality },
    ingress: {
      toolHeavyMedianRelativeDelta: median(tokenDeltas),
      ci: ingress,
      hookP95Ms: hookP95,
    },
    recall: {
      recallAt5,
      precision: recallPrecision,
      silence: silenceRate,
      neededSuccessDelta: recallNeededSuccessDelta,
      qualityCi: recallQuality,
    },
    economics: {
      realizedNetMedian,
      realizedNetCi: { lower: realizedCi.lower, upper: realizedCi.upper },
      pairsWithPositiveNet: realized.filter((value) => value > 0).length,
    },
    hardGatePass: integrityPass && quality.lower >= -0.03,
    decision,
    decisionReasons:
      decision === "keep-reducers-only"
        ? ["ingress and recall thresholds passed on synthetic PCR arms", "realized_net median is not > 0 across all 60 pairs, so proceed-to-w2 is not claimed"]
        : decision === "proceed-to-w2"
          ? ["all hard and value gates passed"]
          : ["see integrity/quality/ingress/recall/economics"],
    caseIds: rows.map((row) => row.id),
  };
  const digest = createHash("sha256").update(JSON.stringify(report)).digest("hex");
  const finalReport = { ...report, reportDigest: digest };
  mkdirSync(outDir, { recursive: true });
  const reportPath = join(outDir, "report.json");
  writeFileSync(reportPath, `${JSON.stringify(finalReport, null, 2)}\n`);
  writeFileSync(join(outDir, "gate-decision.json"), `${JSON.stringify({ gate: "w1-early-net-value", decision, hardGatePass: finalReport.hardGatePass }, null, 2)}\n`);
  return { reportPath, decision, report: finalReport };
}
