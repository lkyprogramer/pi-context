import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  batchOrderErrors,
  buildReviewPlan,
  CAPABILITY_IDS,
  denominators,
  GUARD_IDS,
  loadReviewFixture,
  QUALITY_IDS,
  validateScenario,
} from "../../eval/local/scenarios.mjs";

test("oracle must have a real source and not be disclosed by the final prompt", () => {
  expect(validateScenario({ seedText: "target=7", witness: "target=8", finalPrompt: "continue", requiresFold: true }).ok).toBe(false);
  expect(validateScenario({ seedText: "target=7", witness: "target=7", finalPrompt: "use target=7", requiresFold: true }).ok).toBe(false);
  expect(validateScenario({ seedText: "target=7", witness: "target=7", finalPrompt: "continue from the recorded target", requiresFold: true }).ok).toBe(true);
});

test("frozen review plan is 32 quality + 4 capability UNRUN episodes", () => {
  const plan = JSON.parse(readFileSync(join(import.meta.dirname, "../../eval/local/review-matrix.json"), "utf8"));
  const built = buildReviewPlan();
  expect(plan.plannedMain).toBe(32);
  expect(plan.plannedCapability).toBe(4);
  expect(plan.order).toHaveLength(36);
  expect(plan.liveStatus).toBe("UNRUN");
  expect(built.order).toEqual(plan.order);
  const d = denominators(plan);
  expect(d.quality).toBe(32);
  expect(d.capability).toBe(4);
  expect(d.noFoldGuard).toBe(2);
  expect(d.live).toBe("UNRUN");
  expect(plan.guardIds).toEqual(GUARD_IDS);
});

test("every Q/C fixture has a hidden witness", () => {
  for (const id of [...QUALITY_IDS, ...CAPABILITY_IDS]) {
    const fx = loadReviewFixture(id);
    const v = validateScenario(fx);
    expect(v.ok, `${id} ${v.errors.join(",")}`).toBe(true);
    expect(fx.oracle).toBeTruthy();
    if (id.startsWith("Q")) expect(fx.requiresFold).toBe(true);
  }
});

test("G01/G02 guards are hidden-witness no-fold fixtures", () => {
  for (const id of GUARD_IDS) {
    const fx = loadReviewFixture(id);
    const v = validateScenario(fx);
    expect(v.ok, `${id} ${v.errors.join(",")}`).toBe(true);
    expect(fx.kind).toBe("controlled-guard");
    expect(fx.requiresFold).toBe(false);
    expect(fx.finalPrompt.includes(fx.witness)).toBe(false);
  }
});

test("two-tool batch swap and drop are detected", () => {
  expect(batchOrderErrors([{ name: "readB" }, { name: "readA" }], ["readA", "readB"])).toContain("swapped:readA->readB");
  expect(batchOrderErrors([{ name: "readA" }], ["readA", "readB"])).toContain("missing:readB");
  expect(batchOrderErrors([{ name: "readA" }, { name: "readB" }], ["readA", "readB"])).toEqual([]);
});
