import { describe, expect, it } from "vitest";
import { shrinkRatio, sizeCompactPayloads } from "./e2e-compact.js";

describe("compact payload sizing", () => {
  it("keeps seed1 under the threshold and seed2 above keepRecent so the cut can drop seed1", () => {
    const sys = 500;
    const threshold = 6144;
    const keepRecent = 800;
    const contextWindow = 8192;
    const { seed1Tokens, seed2Tokens } = sizeCompactPayloads(sys, threshold, keepRecent, contextWindow);
    const afterSeed1 = sys + seed1Tokens + 200;
    const afterSeed2 = afterSeed1 + seed2Tokens + 200;
    expect(afterSeed1).toBeLessThan(threshold);
    expect(afterSeed2).toBeGreaterThan(threshold);
    expect(afterSeed2).toBeLessThan(contextWindow);
    expect(seed2Tokens).toBeGreaterThan(keepRecent);
    expect(seed2Tokens).toBeLessThan(seed1Tokens);
  });

  it("computes probe shrink against seed1", () => {
    expect(shrinkRatio(5000, 1800)).toBe(0.64);
    expect(shrinkRatio(null, 1800)).toBeNull();
  });
});
