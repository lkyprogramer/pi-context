import { describe, expect, it } from "vitest";
import { buildBenchmarkReport, evaluateBenchmarkGate, renderReportMarkdown, runSyntheticW1Gate } from "../src/report.js";
import { reportFixture, w1PartialFixture } from "./fixtures.js";

describe("report and gate engine", () => {
  it("stops on integrity failure despite large token savings", () => {
    const d = evaluateBenchmarkGate(reportFixture({ integrityPass: false, ingressTokenMedianDelta: -0.9 }));
    expect(d.decision).toBe("stop");
  });

  it("returns keep-reducers-only when ingress passes but proactive recall fails", () => {
    const d = evaluateBenchmarkGate(w1PartialFixture());
    expect(d.decision).toBe("keep-reducers-only");
  });

  it("builds a machine-readable report", () => {
    const report = buildBenchmarkReport(reportFixture());
    expect(report.hardGatePass).toBe(true);
    expect(renderReportMarkdown(report)).toContain(report.runId);
  });

  it("runs the synthetic 60-boundary engine without a publication claim", async () => {
    const result = await runSyntheticW1Gate();
    expect(result.scenarioCount).toBe(60);
    expect(result.publicationClaim).toBe(false);
    expect(result.corpusClass).toBe("synthetic-public");
    expect(result.decision.reasons.join(" ")).toMatch(/synthetic-public/);
    expect(result.gateInput.integrityPass).toBe(true);
    expect(result.gateInput.ingressTokenMedianDelta).toBeLessThanOrEqual(-0.2);
    expect(result.gateInput.recallAt5).toBeGreaterThanOrEqual(0);
    expect(result.gateInput.recallAt5).toBeLessThanOrEqual(1);
  });

  it("does not claim proceed-to-w2 from an unverified 60-boundary run", () => {
    const d = evaluateBenchmarkGate(
      reportFixture({
        integrityPass: true,
        recallAt5: 0,
        recallNeededSuccessDelta: 0,
        realizedNetMedian: 0,
        ingressTokenMedianDelta: 0,
        ingressTokenCiUpper: 0,
      }),
    );
    expect(d.decision).not.toBe("proceed-to-w2");
  });
});
