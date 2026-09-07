import { describe, expect, it } from "vitest";
import { measurePiCloneFixture } from "./support.js";

describe("pi clone spike", () => {
  it("records clone latency for 1K/10K/100K messages without inventing a pass threshold", async () => {
    const report = await measurePiCloneFixture({ sizes: [1_000, 10_000, 100_000], iterations: 8 });
    expect(report.results.map((item) => item.name)).toEqual(["clone-1k", "clone-10k", "clone-100k"]);
    expect(report.environment.platform).toMatch(/darwin|linux|win32/);
    for (const item of report.results) {
      expect(item.samples.length).toBeGreaterThan(0);
      expect(item.p95Ms).toBeGreaterThanOrEqual(item.p50Ms);
    }
  });
});
