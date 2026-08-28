import { describe, expect, it } from "vitest";
import { CalibrationBucket, safeUsageDelta } from "../src/budget/calibration.js";
import { predictNextStepGrowth } from "../src/budget/growth.js";
import {
  cacheCost,
  capacityUnchangedByCache,
  computeEffectiveInputBudget,
  estimateTextTokens,
  pressure,
} from "../src/budget/token-counter.js";

describe("effective input budget", () => {
  it("reserves output headroom exactly once", () => {
    expect(computeEffectiveInputBudget({ contextWindow: 128000, maxOutputTokens: 16000, providerReservedTokens: 2000 })).toBe(110000);
  });

  it("lets cache tokens change cost but not capacity", () => {
    const envelope = { contextWindow: 8000, maxOutputTokens: 1000, providerReservedTokens: 100 };
    expect(capacityUnchangedByCache(envelope, 0)).toBe(capacityUnchangedByCache(envelope, 4000));
    expect(cacheCost(0, 100, { read: 0.1, write: 0.5 })).toBe(50);
    expect(cacheCost(200, 100, { read: 0.1, write: 0.5 })).toBe(70);
  });

  it("resets the calibration bucket when the model switches", () => {
    const bucket = new CalibrationBucket({ modelKey: "model-a", viewId: "v1" });
    bucket.observe({ heuristicTokens: 100, providerInputTokens: 80 }, { modelKey: "model-a", viewId: "v1" });
    expect(bucket.apply(100)).toBe(80);
    expect(bucket.observe({ heuristicTokens: 100, providerInputTokens: 50 }, { modelKey: "model-b", viewId: "v1" })).toBe(1);
    expect(bucket.modelKey()).toBe("model-b");
    expect(bucket.apply(100)).toBe(100);
  });

  it("counts CJK and emoji denser than latin", () => {
    expect(estimateTextTokens("你好世界")).toBeGreaterThan(estimateTextTokens("abcd"));
    expect(estimateTextTokens("🚀🎉")).toBeGreaterThan(estimateTextTokens("ab"));
  });

  it("does not turn a smaller provider usage into an unsafe negative delta", () => {
    expect(safeUsageDelta(100, 10)).toBe(0);
    expect(safeUsageDelta(100, 140)).toBe(40);
    const bucket = new CalibrationBucket({ modelKey: "m" });
    bucket.observe({ heuristicTokens: 100, providerInputTokens: 10 }, { modelKey: "m" });
    expect(bucket.apply(100)).toBeGreaterThanOrEqual(0);
  });

  it("uses a conservative p95 growth predictor", () => {
    expect(predictNextStepGrowth([])).toBe(256);
    expect(predictNextStepGrowth([10, 12, 11, 400])).toBeGreaterThanOrEqual(256);
    expect(pressure(50, 50, 100)).toBe(1);
    expect(pressure(1, 1, 0)).toBe(Number.POSITIVE_INFINITY);
  });
});
