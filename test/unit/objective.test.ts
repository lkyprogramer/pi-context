import { expect, test } from "vitest";
import { objectiveFromPairs, metricOf } from "../../eval/local/gate.mjs";

const ep = (fresh: number[], cache: number[], wallMs: number) => ({
  wallMs,
  engine: { prefillTokensDelta: fresh.reduce((a, b) => a + b, 0) },
  mechanism: { nativeCompactions: 0 },
  requests: fresh.map((f, i) => ({ normalized: { freshInput: f, cachedRead: cache[i], logicalInput: f + cache[i] } })),
});

test("fresh-input objective is candidate over native minus one, pooled across pairs", () => {
  const pairs = [
    { caseId: "Q01", rep: 1, native: ep([45000, 200], [0, 45000], 40000), candidate: ep([11000, 150], [0, 11000], 30000) },
    { caseId: "Q01", rep: 2, native: ep([45000, 300], [0, 45000], 42000), candidate: ep([11000, 250], [0, 11000], 31000) },
  ].map((p) => ({ ...p, nativeMetric: allMetrics(p.native), candidateMetric: allMetrics(p.candidate) }));
  const o = objectiveFromPairs(pairs, { primary: { metric: "fresh-input", minImprovement: 0.1 }, secondary: ["logical-input", "wall-time"] });
  expect(o.primary.known).toBe(true);
  expect(o.primary.nativeSum).toBe(90500);
  expect(o.primary.candidateSum).toBe(22400);
  expect(o.primary.relativeChange).toBeCloseTo(22400 / 90500 - 1, 6);
  expect(o.secondary["wall-time"].relativeChange).toBeCloseTo(61000 / 82000 - 1, 6);
});

test("one unknown request makes the primary objective unknown, not zero", () => {
  const bad = ep([45000, 200], [0, 45000], 40000);
  bad.requests[1].normalized.freshInput = null as unknown as number;
  const pairs = [{ caseId: "Q01", rep: 1, nativeMetric: allMetrics(bad), candidateMetric: allMetrics(ep([11000], [0], 30000)) }];
  const o = objectiveFromPairs(pairs, { primary: { metric: "fresh-input", minImprovement: 0.1 }, secondary: [] });
  expect(o.primary.known).toBe(false);
  expect(o.primary.relativeChange).toBeNull();
});

test("nativeSum of zero is unknown, not a win", () => {
  const pairs = [{
    caseId: "Q01",
    rep: 1,
    nativeMetric: { "fresh-input": 0 },
    candidateMetric: { "fresh-input": 0 },
  }];
  const o = objectiveFromPairs(pairs, { primary: { metric: "fresh-input", minImprovement: 0.1 }, secondary: [] });
  expect(o.primary.known).toBe(false);
  expect(o.primary.relativeChange).toBeNull();
});

function allMetrics(e: ReturnType<typeof ep>) {
  const out: Record<string, number | null> = {};
  for (const m of ["fresh-input", "logical-input", "wall-time", "cacheRead", "engine-prefill", "native-compactions", "requests"]) out[m] = metricOf(e, m);
  return out;
}
