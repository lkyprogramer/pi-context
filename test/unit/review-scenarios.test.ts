import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { markerLine, setupLogWorkspace } from "../../eval/local/log-workspace.mjs";
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

test("frozen review plan is 48 quality + 6 capability + 24 warm + 6 long UNRUN episodes", () => {
  const plan = JSON.parse(readFileSync(join(import.meta.dirname, "../../eval/local/review-matrix.json"), "utf8"));
  const built = buildReviewPlan();
  expect(plan.plannedEpisodes).toBe(84);
  expect(plan.expectedPairs).toBe(24);
  expect(plan.expectedRegimePairs).toEqual({ warm: 12, long: 3 });
  expect(plan.exactQuoteIds).toEqual(["X01"]);
  expect(plan.semanticQuoteIds).toEqual(["Q05"]);
  expect(plan.order).toHaveLength(84);
  expect(plan.liveStatus).toBe("UNRUN");
  expect(built.order).toEqual(plan.order);
  expect(plan.order.every((o: { status: string; lane: string }) => o.status === "UNRUN" && ["Q", "C", "W", "X"].includes(o.lane))).toBe(true);
  const d = denominators(plan);
  expect(d.quality).toBe(48);
  expect(d.capability).toBe(6);
  expect(d.regime).toBe(30);
  expect(d.noFoldGuard).toBe(2);
  expect(d.live).toBe("UNRUN");
  expect(plan.guardIds).toEqual(GUARD_IDS);
});

test("X01 workspace puts exactly one marker at build-07 line 210 and nothing else matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "x01-"));
  const spec = { count: 12, lines: 300, marked: 7, markLine: 210, token: "FIRST-ERROR-MARKER" };
  const m = setupLogWorkspace(dir, spec);
  expect(m.file).toBe("logs/build-07.log");
  const all = readdirSync(join(dir, "logs")).sort();
  expect(all).toHaveLength(12);
  let hits = 0;
  for (const f of all) {
    for (const [i, line] of readFileSync(join(dir, "logs", f), "utf8").split("\n").entries()) {
      if (line.includes(spec.token)) {
        hits++;
        expect(f).toBe("build-07.log");
        expect(i + 1).toBe(210);
        expect(line).toBe(markerLine(spec));
      }
    }
  }
  expect(hits).toBe(1);
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
