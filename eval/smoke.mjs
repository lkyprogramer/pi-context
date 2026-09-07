#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { runLiveAgent } from "./live-g4.mjs";
import { buildEvaluation } from "./report.ts";
import { armOrderFor, hostManifest, loadSmokePlan } from "./runner.ts";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadDotenv() {
  const file = join(repo, ".env");
  try {
    const text = readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/u)) {
      if (!line || line.startsWith("#") || !line.includes("=")) continue;
      const eq = line.indexOf("=");
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    /* no .env */
  }
}

loadDotenv();
process.env.PCR_LIVE = "1";

const plan = loadSmokePlan();
const env = {
  apiKey: process.env.PCR_LIVE_API_KEY?.trim(),
  baseUrl: process.env.PCR_LIVE_BASE_URL?.trim(),
  model: process.env.PCR_LIVE_MODEL?.trim(),
  provider: process.env.PCR_LIVE_PROVIDER?.trim() || "openclaw",
};
const outDir = join(repo, "artifacts/v5-evaluation");
mkdirSync(outDir, { recursive: true });

const pairs = [];
const caseResults = {};
let remaining = plan.totalWallBudgetSeconds;
const started = Date.now();

if (!env.apiKey || !env.baseUrl || !env.model) {
  const blocked = {
    status: "blocked",
    note: "PCR_LIVE credentials missing",
    recommendation: { level: "observe", reason: "no live credentials" },
  };
  writeFileSync(join(outDir, "report.json"), `${JSON.stringify(blocked, null, 2)}\n`);
  console.log(JSON.stringify(blocked, null, 2));
  process.exit(2);
}

for (const caseId of plan.caseIds) {
  const order = armOrderFor(plan.seed, caseId);
  const pair = {
    kind: "real-run",
    taskId: caseId,
    clusterId: caseId,
    repetition: 0,
    provenance: "real-independent",
    baseline: { arm: "B0", status: "not-run", taskPassed: null, criticalViolation: null, wallMs: null, monetaryCost: null },
    candidate: { arm: "B2", status: "not-run", taskPassed: null, criticalViolation: null, wallMs: null, monetaryCost: null },
  };
  caseResults[caseId] = {};
  for (const arm of order) {
    if (remaining <= 5) {
      const slot = arm === "B0" ? pair.baseline : pair.candidate;
      slot.status = "incomplete";
      caseResults[caseId][arm] = { status: "incomplete", note: "wall budget exhausted" };
      continue;
    }
    const nonce = randomBytes(16).toString("hex");
    const t0 = Date.now();
    const result = runLiveAgent(env, caseId, {
      arm,
      plugin: arm === "B2",
      timeoutMs: Math.min(plan.perArmWallBudgetSeconds, remaining) * 1000,
      seedNonce: nonce,
    });
    const used = (Date.now() - t0) / 1000;
    remaining -= used;
    const slot = arm === "B0" ? pair.baseline : pair.candidate;
    slot.status = result.status === "passed" ? "complete" : result.status === "blocked" ? "blocked" : result.status === "failed" ? "complete" : result.status;
    slot.taskPassed = result.status === "passed";
    slot.wallMs = Math.round(used * 1000);
    slot.monetaryCost = null;
    caseResults[caseId][arm] = result;
  }
  pairs.push(pair);
}

const evaluation = buildEvaluation(pairs);
const report = {
  kind: "v5-smoke-evaluation",
  plan: { caseIds: plan.caseIds, arms: plan.arms, seed: plan.seed },
  elapsedMs: Date.now() - started,
  remainingSeconds: remaining,
  manifest: hostManifest(),
  evaluation,
  cases: Object.fromEntries(Object.entries(caseResults).map(([id, arms]) => [id, {
    B0: arms.B0?.status,
    B2: arms.B2?.status,
    B0oracle: arms.B0?.oracle?.status,
    B2oracle: arms.B2?.oracle?.status,
    B2c2: arms.B2?.c2 ?? null,
  }])),
};
writeFileSync(join(outDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(join(outDir, "pairs.json"), `${JSON.stringify(pairs, null, 2)}\n`);
console.log(JSON.stringify({
  recommendation: evaluation.recommendation,
  summary: evaluation.summary,
  twoPercentNiClaimAllowed: evaluation.twoPercentNiClaimAllowed,
  cases: report.cases,
}, null, 2));
process.exit(evaluation.recommendation.level === "observe" && evaluation.summary.complete === 0 ? 2 : 0);
