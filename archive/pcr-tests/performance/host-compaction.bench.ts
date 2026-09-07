import { describe, expect, it } from "vitest";
import { captureEnvironment, runPerformanceSpikes } from "./support.js";

describe("host compaction soak", () => {
  it("records steady-state checkpoint build samples without inventing a latency gate", async () => {
    const cold = await runPerformanceSpikes(
      [{ name: "host-compaction-cold", kind: "host-compaction", options: { iterations: 12 } }],
      captureEnvironment("cold"),
    );
    const warm = await runPerformanceSpikes(
      [{ name: "host-compaction-warm", kind: "host-compaction", options: { iterations: 12 } }],
      captureEnvironment("warm"),
    );
    expect(cold.results[0]?.phase).toBe("cold");
    expect(warm.results[0]?.phase).toBe("warm");
    expect(warm.results[0]?.samples).toHaveLength(12);
    expect(warm.results[0]?.p95Ms).toBeGreaterThanOrEqual(warm.results[0]?.p50Ms ?? 0);
  });
});
