import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const REVIEW_FIXTURE_DIR = join(here, "review-fixtures");
export const QUALITY_IDS = ["Q01", "Q02", "Q03", "Q04", "Q05", "Q06", "Q07", "Q08"];
export const CAPABILITY_IDS = ["C01", "C02"];
export const GUARD_IDS = ["G01", "G02"];
export const NO_FOLD_REGRESSION = ["L01", "L02", "L03", "L04", "L05", "L06"];
export const REGIME_LANES = {
  warm: ["W-Q01", "W-Q03", "W-Q05", "W-Q07"],
  long: ["X01"],
};

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

function pushCase(order, id, arms, kind, lane, repsPerCase) {
  for (let rep = 1; rep <= repsPerCase; rep++) {
    for (const arm of arms) {
      order.push({
        episodeId: `review:${id}:${arm}:r${rep}`,
        caseId: id,
        arm,
        rep,
        kind,
        lane,
        status: "UNRUN",
      });
    }
  }
}

export function buildReviewPlan({ repsPerCase = 3 } = {}) {
  const order = [];
  const requiresFold = {};
  for (const id of QUALITY_IDS) {
    pushCase(order, id, ["native", "balanced"], "quality", "Q", repsPerCase);
    requiresFold[id] = true;
  }
  for (const id of CAPABILITY_IDS) {
    pushCase(order, id, ["balanced"], "capability", "C", repsPerCase);
    requiresFold[id] = id !== "C02";
  }
  for (const id of REGIME_LANES.warm) {
    pushCase(order, id, ["native", "balanced"], "regime", "W", repsPerCase);
    requiresFold[id] = true;
  }
  for (const id of REGIME_LANES.long) {
    pushCase(order, id, ["native", "balanced"], "regime", "X", repsPerCase);
    requiresFold[id] = true;
  }
  const expectedPairs = QUALITY_IDS.length * repsPerCase;
  const expectedCapabilities = CAPABILITY_IDS.length * repsPerCase;
  const expectedRegimePairs = {
    warm: REGIME_LANES.warm.length * repsPerCase,
    long: REGIME_LANES.long.length * repsPerCase,
  };
  const plannedEpisodes = expectedPairs * 2 + expectedCapabilities + expectedRegimePairs.warm * 2 + expectedRegimePairs.long * 2;
  return {
    schemaVersion: 2,
    repsPerCase,
    plannedMain: expectedPairs * 2,
    plannedCapability: expectedCapabilities,
    plannedEpisodes,
    liveStatus: "UNRUN",
    qualityIds: QUALITY_IDS,
    capabilityIds: CAPABILITY_IDS,
    regimeLanes: {
      warm: { ids: [...REGIME_LANES.warm], arms: ["native", "balanced"] },
      long: { ids: [...REGIME_LANES.long], arms: ["native", "balanced"] },
    },
    guardIds: GUARD_IDS,
    noFoldRegression: NO_FOLD_REGRESSION,
    exactQuoteIds: ["Q05", "X01"],
    requiresFold,
    expectedPairs,
    expectedCapabilities,
    expectedRegimePairs,
    objective: {
      primary: { metric: "fresh-input", minImprovement: 0.1 },
      secondary: ["logical-input", "wall-time", "cacheRead", "engine-prefill", "native-compactions", "requests"],
    },
    window: { triggerPercent: 60, protectRecentBatches: 4, minRemovedTokens: 4096 },
    budget: {
      episode: { wallMs: 600_000, modelCalls: 24, toolCalls: 48 },
      episodeLong: { wallMs: 900_000, modelCalls: 40, toolCalls: 80 },
      run: { totalWallMs: 7_200_000, totalModelCalls: 1_500, totalToolCalls: 2_400 },
    },
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
    regime: plan.order.filter((o) => o.kind === "regime").length,
    noFoldGuard: plan.guardIds.length,
    live: plan.liveStatus,
  };
}
