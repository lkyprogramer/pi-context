#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REQUIRED_EVIDENCE = ["T34", "T35", "T36", "T37", "T38", "T45"];

export function checkSemanticSafety(evidence) {
  const reasons = [];
  if (evidence.verifierMutationPass === false) reasons.push("verifier-mutation-failed");
  if ((evidence.unsupportedOutcomes ?? 0) > 0) reasons.push("unsupported-outcomes");
  if (evidence.semanticOffArmIdentical === false) reasons.push("semantic-off-arm-diverged");
  if ((evidence.criticalBucketRegressions ?? 0) > 0) reasons.push("bucket-regression");
  if ((evidence.securityCritical ?? 0) > 0 || (evidence.securityHigh ?? 0) > 0) reasons.push("security-finding");
  for (const waiver of evidence.waivers ?? []) {
    if (waiver.severity === "critical" || waiver.severity === "high") reasons.push("waiver-blocked");
  }
  return { ok: reasons.length === 0, reasons };
}

export function evaluateSemanticBetaGate(e) {
  const qualityGain = e.qualityGain ?? 0;
  const staleCost = e.staleCost ?? 0;
  const staleWorkRatio = e.staleWorkRatio ?? staleCost;
  const maxStaleRatio = e.maxStaleRatio ?? 1;
  const realizedNetValue = e.realizedNetValue ?? 0;
  const nonInferiorityMargin = e.nonInferiorityMargin ?? 0.02;
  const safety = checkSemanticSafety(e);
  if (!safety.ok) {
    return {
      release: "blocked",
      semanticDefault: "off",
      reasons: safety.reasons,
      featureFlag: "semanticDefault=off",
    };
  }
  if (e.t45Decision && e.t45Decision !== "proceed-to-semantic-beta") {
    return {
      release: "deterministic-only",
      semanticDefault: "off",
      reasons: ["not-enabled-by-release-profile"],
      featureFlag: "semanticDefault=off",
      ablation: e.ablation ?? { semanticOffIdenticalToDeterministic: e.semanticOffArmIdentical !== false },
      staleWorkBudget: { staleCost, staleWorkRatio, maxStaleRatio, covered: false },
    };
  }
  const gainCoversStale = qualityGain > staleCost;
  const positive =
    qualityGain > nonInferiorityMargin &&
    realizedNetValue > 0 &&
    staleWorkRatio <= maxStaleRatio &&
    gainCoversStale &&
    e.cacheEconomicsOk !== false;
  return {
    release: positive ? "beta" : "deterministic-only",
    semanticDefault: positive ? "quality-profile-only" : "off",
    reasons: positive ? [] : ["insufficient-net-value"],
    featureFlag: positive ? "semanticDefault=quality-profile-only" : "semanticDefault=off",
    ablation: e.ablation ?? { semanticOffIdenticalToDeterministic: e.semanticOffArmIdentical !== false },
    staleWorkBudget: { staleCost, staleWorkRatio, maxStaleRatio, covered: gainCoversStale },
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadSemanticBetaEvidence(root = process.cwd(), t45Decision = "stop-at-deterministic-slice") {
  const missing = [];
  const evidence = {};
  for (const taskId of REQUIRED_EVIDENCE) {
    const path = join(root, "artifacts/task-evidence", `${taskId}.json`);
    if (!existsSync(path)) {
      missing.push(taskId);
      continue;
    }
    evidence[taskId] = readJson(path);
  }
  return {
    qualityGain: 0,
    staleCost: 0,
    staleWorkRatio: 0,
    maxStaleRatio: 1,
    realizedNetValue: 0,
    nonInferiorityMargin: 0.02,
    t45Decision,
    semanticOffArmIdentical: true,
    verifierMutationPass: missing.length === 0 && REQUIRED_EVIDENCE.every((id) => evidence[id]?.status === "done"),
    providerBuckets: [],
    cacheEconomicsOk: false,
    unsupportedOutcomes: 0,
    missingEvidence: missing,
  };
}

export async function evaluateRepoSemanticBetaGate(root = process.cwd()) {
  let t45Decision = "stop-at-deterministic-slice";
  try {
    const mod = await import(new URL("./deterministic-mvp.mjs", import.meta.url));
    t45Decision = mod.evaluateRepoDeterministicMvpGate(root).decision;
  } catch {
    t45Decision = "stop-at-deterministic-slice";
  }
  const loaded = loadSemanticBetaEvidence(root, t45Decision);
  return { ...evaluateSemanticBetaGate(loaded), evidence: loaded };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const report = await evaluateRepoSemanticBetaGate(root);
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (process.env.PCR_GATE_WRITE === "1") {
    const outDir = join(root, "reports/gates/semantic-beta");
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "latest.json"), text);
  }
  console.log(text);
  if (report.release === "blocked") process.exit(1);
}
