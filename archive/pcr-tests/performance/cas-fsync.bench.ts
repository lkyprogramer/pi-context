import { describe, expect, it } from "vitest";
import { captureEnvironment, runPerformanceSpikes } from "./support.js";

describe("CAS fsync spike", () => {
  it("records 256KB put latency for normal durability without a hardcoded pass", async () => {
    const report = await runPerformanceSpikes(
      [{ name: "cas-256kb", kind: "cas-fsync", options: { bytes: 256 * 1024, iterations: 6 } }],
      captureEnvironment("warm"),
    );
    const result = report.results[0];
    expect(result?.samples.length).toBeGreaterThan(0);
    expect(result?.p95Ms).toBeGreaterThanOrEqual(result?.p50Ms ?? 0);
    expect(report.environment.durability).toMatch(/normal|full/);
    expect(report.sloRecommendations["cas-256kb"]).toBeGreaterThan(0);
  });
});
