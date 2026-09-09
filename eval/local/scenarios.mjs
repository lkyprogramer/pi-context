import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REVIEW_FIXTURE_DIR = join(here, "review-fixtures");
export const QUALITY_IDS = ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08"];
export const CAPABILITY_IDS = ["C01", "C02"];
export const GUARD_IDS = ["G01", "G02"];
export const NO_FOLD_REGRESSION = ["L01", "L02", "L03", "L04", "L05", "L06"];

export function validateScenario({ seedText, witness, finalPrompt, requiresFold }) {
  const errors = [];
  if (typeof seedText !== "string" || seedText.length === 0) errors.push("missing-seed");
  if (typeof witness !== "string" || witness.length === 0) errors.push("missing-witness");
  if (typeof finalPrompt !== "string" || finalPrompt.length === 0) errors.push("missing-prompt");
  if (requiresFold !== true && requiresFold !== false) errors.push("missing-requiresFold");
  if (witness && seedText && !seedText.includes(witness)) errors.push("witness-not-in-seed");
  if (witness && finalPrompt && finalPrompt.includes(witness)) errors.push("oracle-leaked-in-prompt");
  return { ok: errors.length === 0, errors };
}

export function loadReviewFixture(id) {
  const path = join(REVIEW_FIXTURE_DIR, `${id}.json`);
  if (!existsSync(path)) throw new Error(`review fixture missing: ${id}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

export function listReviewFixtures() {
  if (!existsSync(REVIEW_FIXTURE_DIR)) return [];
  return readdirSync(REVIEW_FIXTURE_DIR).filter((n) => n.endsWith(".json")).map((n) => n.replace(/\.json$/, "")).sort();
}

export function buildReviewPlan() {
  const order = [];
  for (const id of QUALITY_IDS) {
    for (let rep = 1; rep <= 2; rep++) {
      for (const arm of ["native", "balanced"]) {
        order.push({ episodeId: `review:${id}:${arm}:r${rep}`, caseId: id, arm, rep, kind: "quality", status: "UNRUN" });
      }
    }
  }
  for (const id of CAPABILITY_IDS) {
    for (let rep = 1; rep <= 2; rep++) {
      order.push({ episodeId: `review:${id}:balanced:r${rep}`, caseId: id, arm: "balanced", rep, kind: "capability", status: "UNRUN" });
    }
  }
  return {
    schemaVersion: 1,
    plannedMain: 32,
    plannedCapability: 4,
    plannedEpisodes: 36,
    liveStatus: "UNRUN",
    qualityIds: QUALITY_IDS,
    capabilityIds: CAPABILITY_IDS,
    guardIds: GUARD_IDS,
    noFoldRegression: NO_FOLD_REGRESSION,
    optional: ["H03"],
    window: { triggerPercent: 60, protectRecentBatches: 4, minRemovedTokens: 4096 },
    order,
  };
}

export function batchOrderErrors(observed, expectedNames) {
  const names = (observed ?? []).map((c) => c.name);
  const errors = [];
  if (names.length !== expectedNames.length) errors.push("batch-arity");
  for (let i = 0; i < expectedNames.length; i++) {
    if (names[i] !== expectedNames[i]) errors.push(names[i] == null ? `missing:${expectedNames[i]}` : `swapped:${expectedNames[i]}->${names[i]}`);
  }
  return errors;
}

export function denominators(plan = buildReviewPlan()) {
  return {
    quality: plan.order.filter((o) => o.kind === "quality").length,
    capability: plan.order.filter((o) => o.kind === "capability").length,
    noFoldGuard: plan.guardIds.length,
    live: plan.liveStatus,
  };
}
