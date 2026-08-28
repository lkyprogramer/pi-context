import { describe, expect, it } from "vitest";
import {
  cacheInvariantOutputHash,
  calculateRealizedNetValue,
  pricedTokens,
  qualityRegressionCost,
  sanitizeTelemetry,
} from "../../kernel/src/control/economics.js";
import { backgroundStaleMetrics, cachePrefixMetrics } from "../src/telemetry/events.js";
import { createMemorySink, emitTelemetry } from "../src/telemetry/sink.js";

describe("economics telemetry", () => {
  it("charges cache rewrite, recall and stale work without logging raw paths", () => {
    expect(calculateRealizedNetValue({ avoidedInput: 10, avoidedOverflow: 2, summary: 3, cacheRewrite: 4, recall: 1, qualityRegression: 0, staleBackground: 2 })).toBe(2);
    expect(JSON.stringify(sanitizeTelemetry({ path: "/home/user/secret/project" }))).not.toContain("/home/user");
  });

  it("keeps outputHash equal when cache is enabled or disabled", () => {
    const body = { sections: ["preamble", "suffix"], tokens: 12 };
    expect(cacheInvariantOutputHash(body, true)).toBe(cacheInvariantOutputHash(body, false));
  });

  it("keeps token metrics when provider price is unknown and does not invent currency", () => {
    expect(pricedTokens(40)).toEqual({ tokens: 40 });
    expect(pricedTokens(40, Number.NaN)).toEqual({ tokens: 40 });
    expect(pricedTokens(40, 2)).toEqual({ tokens: 40, currency: 80 });
  });

  it("counts stale candidate waste separately from successful-task net", () => {
    const stale = backgroundStaleMetrics({ stale: 1, wastedTokens: 9, readyHit: 0 });
    expect(stale.wastedTokens).toBe(9);
    expect(calculateRealizedNetValue({
      avoidedInput: 10,
      avoidedOverflow: 0,
      summary: 0,
      cacheRewrite: 0,
      recall: 0,
      qualityRegression: 0,
      staleBackground: stale.wastedTokens,
      taskSucceeded: true,
    })).toBe(1);
    expect(calculateRealizedNetValue({
      avoidedInput: 10,
      avoidedOverflow: 0,
      summary: 0,
      cacheRewrite: 0,
      recall: 0,
      qualityRegression: 0,
      staleBackground: stale.wastedTokens,
      taskSucceeded: false,
    })).toBe(0);
  });

  it("applies quality regression only from a paired benchmark", () => {
    expect(qualityRegressionCost({})).toBe(0);
    expect(qualityRegressionCost({ pairedBenchmark: { before: 8, after: 5 } })).toBe(3);
    const prefix = cachePrefixMetrics({ eligiblePrefixTokens: 20, firstDifference: 4, cacheReadTokens: 16, cacheWriteTokens: 2 });
    const sink = createMemorySink();
    const event = emitTelemetry(
      { name: "pcr.cache", path: "/tmp/secret/repo", metrics: { ...prefix, staleBackground: 2 }, prompt: "raw prompt" },
      sink,
    );
    expect(event.schemaVersion).toBe(1);
    expect(event.eventId).toMatch(/^te_[a-f0-9]{8,64}$/);
    expect(JSON.stringify(sink.events)).not.toContain("/tmp/secret");
    expect(JSON.stringify(sink.events)).not.toContain("raw prompt");
  });
});
