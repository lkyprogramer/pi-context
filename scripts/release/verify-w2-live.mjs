#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function fail(code) {
  process.stderr.write(`${code}\n`);
  process.exit(1);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const directory = resolve(process.argv[2] ?? join(repoRoot, "artifacts/runs/w2-v4-live/paired-gate"));
const canonicalDirectory = join(repoRoot, "artifacts/runs/w2-v4-live/paired-gate");
if (directory !== canonicalDirectory) fail("PCR_W2_LIVE_DIRECTORY_MISMATCH");
const reportPath = join(directory, "report.json");
const manifestPath = join(directory, "run-manifest.json");
const decisionPath = join(directory, "gate-decision.json");
if (!existsSync(reportPath) || !existsSync(manifestPath) || !existsSync(decisionPath)) fail("PCR_W2_LIVE_RUN_MISSING");

const reportBytes = readFileSync(reportPath);
const report = JSON.parse(reportBytes.toString("utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const decisionBytes = readFileSync(decisionPath);
const gateDecision = JSON.parse(decisionBytes.toString("utf8"));
const byteHash = createHash("sha256").update(reportBytes).digest("hex");
const canonicalHash = createHash("sha256").update(canonical(report), "utf8").digest("hex");
if (manifest.artifactBytesSha256 !== byteHash) fail("PCR_W2_LIVE_HASH_MISMATCH:artifactBytesSha256");
if (manifest.canonicalJsonSha256 !== canonicalHash) fail("PCR_W2_LIVE_HASH_MISMATCH:canonicalJsonSha256");
if (manifest.files?.["report.json"] !== byteHash) fail("PCR_W2_LIVE_HASH_MISMATCH:report");
const decisionHash = createHash("sha256").update(decisionBytes).digest("hex");
if (manifest.files?.["gate-decision.json"] !== decisionHash) fail("PCR_W2_LIVE_HASH_MISMATCH:decision");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
if (report.commit !== head) fail("PCR_W2_LIVE_HEAD_MISMATCH");
if (report.runId !== "w2-live-native-gate" || manifest.runId !== report.runId || manifest.profile !== "gate") fail("PCR_W2_LIVE_RUN_ID_MISMATCH");
if (report.scorer !== "w2-scorer-v3" || report.piVersion !== "0.84.4" || report.corpusClass !== "synthetic-public-replayed-into-live-pi-session") fail("PCR_W2_LIVE_IDENTITY_MISMATCH");
if (report.model?.provider !== "openclaw" || report.model?.id !== "openclaw/Qwen3.8-27B-WORK" || report.model?.contextWindow !== 200192) fail("PCR_W2_LIVE_MODEL_MISMATCH");
const packageLockSha256 = createHash("sha256").update(readFileSync(join(repoRoot, "pnpm-lock.yaml"))).digest("hex");
const epochPayload = {
  head,
  packageLockSha256,
  extensionSha256: createHash("sha256").update(readFileSync(join(repoRoot, "apps/pi-context-runtime/dist/extension.js"))).digest("hex"),
  runnerSha256: createHash("sha256").update(readFileSync(join(repoRoot, "tests/live-gate/paired-w2-live.ts"))).digest("hex"),
  rpcSha256: createHash("sha256").update(readFileSync(join(repoRoot, "tests/live-gate/pi-rpc.ts"))).digest("hex"),
  scorerSha256: createHash("sha256").update(readFileSync(join(repoRoot, "tests/w2-gate/scorer.ts"))).digest("hex"),
  model: "openclaw/Qwen3.8-27B-WORK",
  provider: "openclaw",
  contextWindow: 200192,
  maxTokens: 16384,
  corpus: ["tool-heavy", "constraint", "temporal-update", "branch", "overflow"].flatMap((family, familyIndex) => Array.from({ length: 20 }, (_, index) => ({ id: [`th`, `ct`, `tu`, `br`, `ov`][familyIndex] + `-${String(index).padStart(2, "0")}`, family }))),
  scorer: "w2-scorer-v3",
  config: { profile: "gate", reserve: 16384, keepRecent: 2048 },
};
const expectedEpoch = createHash("sha256").update(JSON.stringify(epochPayload), "utf8").digest("hex");
if (report.runEpochHash !== expectedEpoch) fail("PCR_W2_LIVE_EPOCH_MISMATCH");
if (report.model?.maxTokens !== 16384 || report.model?.maxTokensUnmodified !== true || report.cutPolicy?.reserveTokens !== 16384 || report.cutPolicy?.keepRecentTokens !== 2048) fail("PCR_W2_LIVE_CONFIG_MISMATCH");
if (report.sample?.profile !== "gate" || report.sample?.planned !== 300 || report.sample?.expectedPairs !== 300) fail("PCR_W2_LIVE_PLAN_MISMATCH");
if (!Array.isArray(report.pairs) || report.pairs.length !== 300) fail("PCR_W2_LIVE_DENOMINATOR_MISMATCH");
const expectedIds = new Set();
for (const prefix of ["th", "ct", "tu", "br", "ov"]) for (let index = 0; index < 20; index += 1) for (let replicate = 0; replicate < 3; replicate += 1) expectedIds.add(`${prefix}-${String(index).padStart(2, "0")}#s${replicate}`);
const actualIds = report.pairs.map((pair) => pair?.id);
if (new Set(actualIds).size !== 300 || actualIds.some((id) => !expectedIds.has(id))) fail("PCR_W2_LIVE_PAIR_ID_MISMATCH");
const arms = ["b0", "b1", "b2", "f0"];
const completedPairs = report.pairs.filter((pair) => arms.every((arm) => pair?.[arm]?.ok === true));
const familyByPrefix = { th: "tool-heavy", ct: "constraint", tu: "temporal-update", br: "branch", ov: "overflow" };
for (const pair of report.pairs) {
  const match = /^(th|ct|tu|br|ov)-\d{2}#s([0-2])$/u.exec(pair.id);
  if (!match || pair.family !== familyByPrefix[match[1]] || pair.replicateIndex !== Number(match[2])) fail("PCR_W2_LIVE_PAIR_IDENTITY_MISMATCH");
  for (const arm of arms) {
    const value = pair[arm];
    if (value.firstKeptEntryId !== null && typeof value.firstKeptEntryId !== "string") fail("PCR_W2_LIVE_BOUNDARY_ID_INVALID");
    for (const key of ["directiveCoverage", "polarity", "time", "update", "abstention", "quality", "closedLoopSuccess", "constraintViolation", "mustOmitLeak"]) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > 1) fail("PCR_W2_LIVE_ARM_VALUE_INVALID");
    }
    for (const key of ["unsupportedHighRiskOutcome", "toolPairViolation", "recoveryDenominator", "recoveryCount"]) {
      if (!Number.isSafeInteger(value[key]) || value[key] < 0) fail("PCR_W2_LIVE_ARM_COUNT_INVALID");
    }
    if (typeof value.recovered !== "boolean" || typeof value.fromExtension !== "boolean" || !Number.isSafeInteger(value.compactionCount) || value.compactionCount < 0) fail("PCR_W2_LIVE_ARM_STATE_INVALID");
    if (!["ok", "n/a", "failed"].includes(value.recoveryStatus) || typeof value.crossScopeDenied !== "boolean") fail("PCR_W2_LIVE_RECOVERY_STATE_INVALID");
    if (value.recovered && (value.recoveryStatus !== "ok" || value.recoveryDenominator <= 0 || value.recoveryCount !== value.recoveryDenominator || value.crossScopeDenied !== true)) fail("PCR_W2_LIVE_RECOVERY_STATE_INVALID");
    if (!value.recovered && value.recoveryStatus === "n/a" && (value.recoveryDenominator !== 0 || value.recoveryCount !== 0)) fail("PCR_W2_LIVE_RECOVERY_STATE_INVALID");
  }
  const recalculatedSameCut = Boolean(pair.b0.firstKeptEntryId && pair.b1.firstKeptEntryId && pair.b0.firstKeptEntryId === pair.b1.firstKeptEntryId);
  if (pair.sameCut !== recalculatedSameCut) fail("PCR_W2_LIVE_SAME_CUT_MISMATCH");
  if (pair.expectedFirstKeptId !== null && typeof pair.expectedFirstKeptId !== "string") fail("PCR_W2_LIVE_BOUNDARY_ID_INVALID");
  if (pair.b0.ok === true && (typeof pair.expectedFirstKeptId !== "string" || pair.expectedFirstKeptId !== pair.b0.firstKeptEntryId)) fail("PCR_W2_LIVE_BOUNDARY_ID_MISMATCH");
}
const failures = report.pairs.filter((pair) => arms.some((arm) => pair?.[arm]?.ok !== true)).map((pair) => pair.id).sort();
const recalculatedSameCutPairs = completedPairs.filter((pair) => pair.sameCut === true).length;
const expectedSameCutRate = completedPairs.length === 0 ? 0 : recalculatedSameCutPairs / completedPairs.length;
if (report.sample.sameCutPairs !== recalculatedSameCutPairs || report.sharedBoundary?.sameCutRate !== expectedSameCutRate) fail("PCR_W2_LIVE_BOUNDARY_MISMATCH");
const declaredFailures = Array.isArray(report.sample?.armFailures) ? [...report.sample.armFailures].sort() : null;
if (!declaredFailures || JSON.stringify(declaredFailures) !== JSON.stringify(failures)) fail("PCR_W2_LIVE_FAILURES_MISMATCH");
const expectedRetried = report.pairs.reduce((count, pair) => count + arms.filter((arm) => Array.isArray(pair?.[arm]?.attempts) && pair[arm].attempts.some((attempt) => attempt?.attempt > 1)).length, 0);
if (report.sample.attempted !== 300 || report.sample.completedPairs !== 300 - failures.length || report.sample.scored !== report.sample.completedPairs || report.sample.failed !== failures.length || report.sample.retried !== expectedRetried) fail("PCR_W2_LIVE_COUNTS_MISMATCH");
const timeouts = report.pairs.flatMap((pair) => arms.flatMap((arm) => typeof pair?.[arm]?.error === "string" && /timed?\s*out|timeout|did not settle|timeout waiting/iu.test(pair[arm].error) ? [{ id: pair.id, arm, error: pair[arm].error }] : []));
if (JSON.stringify(report.sample.timeouts) !== JSON.stringify(timeouts)) fail("PCR_W2_LIVE_TIMEOUTS_MISMATCH");
if (report.publicationClaim !== false || report.livePiNative !== true) fail("PCR_W2_LIVE_CLAIM_INVALID");
if (!["keep-pi-native", "proceed-to-semantic"].includes(report.decision)) fail("PCR_W2_LIVE_DECISION_INVALID");
if (failures.length > 0 && (report.hard?.hardGatePass !== false || report.decision !== "keep-pi-native")) fail("PCR_W2_LIVE_FAILURE_DECISION_INVALID");
if (report.hard?.hardGatePass !== true && report.decision !== "keep-pi-native") fail("PCR_W2_LIVE_DECISION_INVALID");
if (gateDecision.reportHash !== byteHash || gateDecision.decision !== report.decision || gateDecision.hardGatePass !== report.hard.hardGatePass || gateDecision.publicationClaim !== false) fail("PCR_W2_LIVE_GATE_DECISION_MISMATCH");
if (resolve(gateDecision.reportPath ?? "") !== reportPath) fail("PCR_W2_LIVE_GATE_PATH_MISMATCH");
const expectedHard = {
  directiveCoverage: completedPairs.every((pair) => pair.b2.directiveCoverage === 1) ? 1 : 0,
  unsupportedHighRiskOutcome: completedPairs.filter((pair) => pair.b2.unsupportedHighRiskOutcome > 0).length,
  toolPairViolation: completedPairs.reduce((sum, pair) => sum + arms.reduce((armSum, arm) => armSum + (pair[arm].toolPairViolation ?? 0), 0), 0),
  mustOmitLeak: completedPairs.filter((pair) => pair.b2.mustOmitLeak > 0).length,
  nativeMustOmitLeak: completedPairs.filter((pair) => pair.b0.mustOmitLeak > 0).length,
  exactEvidenceRecovery: completedPairs.length > 0 && completedPairs.every((pair) => pair.b2.recovered === true) ? 1 : 0,
  b1FromHook: completedPairs.every((pair) => pair.b1.fromExtension === true),
  b2FromHook: completedPairs.every((pair) => pair.b2.fromExtension === true),
  b0Native: completedPairs.every((pair) => pair.b0.fromExtension === false),
  f0Ceiling: completedPairs.every((pair) => pair.f0.fromExtension === false && pair.f0.compactionCount === 0),
};
const expectedHardGatePass = failures.length === 0 && expectedHard.directiveCoverage === 1 && expectedHard.unsupportedHighRiskOutcome === 0 && expectedHard.mustOmitLeak === 0 && expectedHard.exactEvidenceRecovery === 1 && expectedHard.toolPairViolation === 0 && expectedHard.b1FromHook && expectedHard.b2FromHook && expectedHard.b0Native && expectedHard.f0Ceiling && report.pairs.every((pair) => pair.sameCut === true);
if (JSON.stringify({ ...expectedHard, hardGatePass: expectedHardGatePass }) !== JSON.stringify(report.hard)) fail("PCR_W2_LIVE_HARD_GATE_MISMATCH");
const quality = report.quality ?? {};
if (!Number.isSafeInteger(quality.completeCase?.n) || quality.completeCase.n !== completedPairs.length || !Number.isSafeInteger(quality.worstCase?.n) || quality.worstCase.n !== report.pairs.length) fail("PCR_W2_LIVE_SENSITIVITY_MISMATCH");
for (const sensitivity of [quality.completeCase?.ci, quality.worstCase?.ci]) {
  if (!sensitivity || !["estimate", "lower", "upper"].every((key) => typeof sensitivity[key] === "number" && Number.isFinite(sensitivity[key]))) fail("PCR_W2_LIVE_SENSITIVITY_MISMATCH");
}
const efficiency = report.efficiency ?? {};
const hard = report.hard ?? {};
const safeLower = (value) => typeof value?.lower === "number" ? value.lower : Number.NEGATIVE_INFINITY;
for (const value of [efficiency.budgetMismatchRate, efficiency.tokenMedianRelativeDelta, efficiency.costPerSuccessRelativeDelta, efficiency.realizedNetMedian, safeLower(quality.ci), safeLower(quality.polarity), safeLower(quality.time), safeLower(quality.update), safeLower(quality.abstention), safeLower(quality.closedLoop)]) {
  if (!Number.isFinite(value)) fail("PCR_W2_LIVE_METRIC_INVALID");
}
const tokenWin = efficiency.budgetMismatchRate === 0 && efficiency.tokenMedianRelativeDelta <= -0.15;
const costWin = efficiency.costPerSuccessRelativeDelta <= -0.1;
const overflowWin = efficiency.overflowRecovery?.B2 > efficiency.overflowRecovery?.B0 && safeLower(efficiency.overflowQuality) >= -0.02;
const expectedDecision = hard.hardGatePass !== true || safeLower(quality.ci) < -0.02 || safeLower(quality.polarity) < -0.02 || safeLower(quality.time) < -0.02 || safeLower(quality.update) < -0.02 || safeLower(quality.abstention) < -0.02 || safeLower(quality.closedLoop) < -0.02 || (quality.constraintViolations?.B2 ?? Number.POSITIVE_INFINITY) > (quality.constraintViolations?.B0 ?? Number.NEGATIVE_INFINITY) || efficiency.realizedNetMedian <= 0 || (!tokenWin && !costWin && !overflowWin) ? "keep-pi-native" : "proceed-to-semantic";
if (report.decision !== expectedDecision) fail("PCR_W2_LIVE_DECISION_MISMATCH");

process.stdout.write(`${JSON.stringify({ ok: true, report: reportPath, pairs: report.pairs.length, decision: report.decision })}\n`);
