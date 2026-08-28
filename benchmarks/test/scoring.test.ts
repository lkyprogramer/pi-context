import { describe, expect, it } from "vitest";
import { defaultBenchmarkConfig, runBenchmarkSuite } from "../src/runner.js";
import { scoreAbstention, scoreConstraintRecall, scorePolarity, scoreTime, scoreUpdate } from "../src/scoring.js";

describe("benchmark scoring", () => {
  it("distinguishes absent, contradicted and correctly applied constraints", () => {
    expect(scoreConstraintRecall({ expected: "must-not deploy", observed: "did not deploy" })).toBe(1);
    expect(scoreConstraintRecall({ expected: "must-not deploy", observed: "deployed" })).toBe(0);
    expect(scoreConstraintRecall({ expected: "must-not deploy", observed: "" })).toBe(0);
  });

  it("scores temporal, update, negation and abstention without a single LLM judge", () => {
    expect(scorePolarity("must-not deploy", "must not ship")).toBe(1);
    expect(scoreTime("2026-08-01", "deadline 2026-08-01; did not deploy")).toBe(1);
    expect(scoreUpdate("owner=alice", "owner=alice updated now")).toBe(1);
    expect(scoreAbstention("cannot determine; abstain")).toBe(1);
  });

  it("pairs the same seed/cut/budget against Pi Native only and keeps publicationClaim false", async () => {
    const report = await runBenchmarkSuite(defaultBenchmarkConfig(7));
    expect(report.publicationClaim).toBe(false);
    expect(report.officialControl).toBe("pi-native");
    expect(report.seed).toBe(7);
    expect(new Set(report.scores.map((item) => item.scenarioId)).size).toBeGreaterThanOrEqual(8);
    expect(report.scores.some((item) => item.arm === "billion-context" && item.isolatedProcess)).toBe(true);
    expect(report.scores.filter((item) => item.arm === "pi-native").every((item) => item.compacted)).toBe(true);
    expect(report.bootstrap.qualityDelta.confidence).toBe(0.95);
  });
});
