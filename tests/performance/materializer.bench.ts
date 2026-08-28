import { describe, expect, it } from "vitest";
import { captureEnvironment, measureMaterializationFixture, percentile, recommendSloMs } from "./support.js";

describe("performance spike harness", () => {
  it("records distributions and machine metadata instead of asserting an invented latency", async () => {
    const report = await measureMaterializationFixture({ events: 100_000, iterations: 50 });
    expect(report.samples).toHaveLength(50);
    expect(report.environment.node).toMatch(/^v/);
    expect(report.p95Ms).toBeGreaterThanOrEqual(report.p50Ms);
  });

  it("keeps cold/warm and OS metadata in the environment instead of inventing a machine-independent SLO", () => {
    const env = captureEnvironment("cold");
    expect(env.phase).toBe("cold");
    expect(env.platform).toMatch(/darwin|linux|win32/);
    expect(env.durability).toMatch(/normal|full/);
    expect(percentile([1, 2, 3, 4], 95)).toBeGreaterThanOrEqual(percentile([1, 2, 3, 4], 50));
    expect(recommendSloMs(12)).toBeGreaterThanOrEqual(12);
  });
});
