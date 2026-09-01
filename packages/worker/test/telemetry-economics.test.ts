import { describe, expect, it } from "vitest";

import { estimateErrorBucket, reconcileUsage } from "@pcr/runtime";
import { createMemorySink, emitTelemetry } from "../src/telemetry/sink.js";

describe("telemetry economics", () => {
  it("does not treat cache-read tokens as window savings and hashes prompt text", () => {
    const usage = reconcileUsage({
      serializedInputTokens: 1000,
      cacheHit: true,
      overflowRetry: false,
      provider: { cacheReadTokens: 900, inputTokens: 50, outputTokens: 20 },
      inputPricePerToken: 2,
      cacheReadPricePerToken: 0.2,
      outputPricePerToken: 3,
    });
    expect(usage.serializedInputTokens).toBe(1000);
    expect(usage.cacheReadTokens).toBe(900);
    expect(usage.uncachedInputTokens).toBe(50);
    expect(usage.totalBilledTokens).toBe(50 + 900 + 20);
    expect(usage.estimatedCost).toBe(50 * 2 + 900 * 0.2 + 20 * 3);
    expect(estimateErrorBucket(1000, 1050)).toBe("lt5");

    const sink = createMemorySink();
    const event = emitTelemetry({
      name: "pcr.usage",
      timestamp: 1,
      workspaceId: "ws_opaque",
      sessionId: "s1",
      viewId: "vw_1",
      dimensions: { prompt: "secret user text", outputHash: "a".repeat(64) },
      metrics: { serializedInputTokens: usage.serializedInputTokens, cacheReadTokens: usage.cacheReadTokens },
    }, sink);
    expect(JSON.stringify(event)).not.toContain("secret user text");
    expect(event.viewId).toBe("vw_1");
    expect(event.metrics.cacheReadTokens).toBe(900);
  });
});
