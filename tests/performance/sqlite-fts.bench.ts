import { describe, expect, it } from "vitest";
import { captureEnvironment, runPerformanceSpikes } from "./support.js";

describe("SQLite/FTS spike", () => {
  it("records query samples after loading a large catalog instead of asserting an invented budget", async () => {
    const documents = process.env.PCR_PERF_FULL === "1" ? 1_000_000 : 8_000;
    const report = await runPerformanceSpikes(
      [{ name: "sqlite-fts", kind: "sqlite-fts", options: { documents, iterations: 5 } }],
      captureEnvironment("warm"),
    );
    expect(report.results[0]?.samples).toHaveLength(5);
    expect(report.results[0]?.p95Ms).toBeGreaterThanOrEqual(report.results[0]?.p50Ms ?? 0);
    expect(report.environment.platform).toMatch(/darwin|linux|win32/);
  });
});
