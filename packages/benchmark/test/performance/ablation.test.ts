import { describe, expect, it } from "vitest";

import { compareCacheLayouts, compareCheckpointMetadata } from "../../src/performance/ablation.js";
import { renderModelCheckpointView } from "@pcr/runtime";

describe("checkpoint-metadata ablation", () => {
  it("reduces next payload tokens without dropping task-visible quotes", () => {
    const checkpoint = {
      snapshotHash: "s".repeat(64),
      directives: [{
        directiveId: "d".repeat(64),
        exactQuote: "keep the staging window",
        kind: "constraint",
        polarity: "must",
        status: "active",
      }],
      claims: [{ claimId: "c1", key: "window", polarity: "is", status: "active", value: "Friday" }],
      pointers: [{ ref: "p".repeat(64), kind: "evidence" }],
      heads: { contextHead: "h".repeat(64) },
      continuity: { revisionId: "r".repeat(64) },
    };
    const on = renderModelCheckpointView(checkpoint, { includeMetadata: true });
    const off = renderModelCheckpointView(checkpoint);
    const report = compareCheckpointMetadata(
      { summaryTokens: on.summary.length, payloadTokens: on.summary.length, cacheEligibleTokens: 80, quality: 1 },
      { summaryTokens: off.summary.length, payloadTokens: off.summary.length, cacheEligibleTokens: 40, quality: 1 },
    );
    expect(report.tokenDelta).toBeGreaterThan(0);
    expect(report.payloadDelta).toBeGreaterThan(0);
    expect(report.qualityNonInferior).toBe(true);
    expect(off.summary).toContain("keep the staging window");
  });

  it("compares cache layouts only after the quality hard gate", () => {
    const blocked = compareCacheLayouts([
      {
        arm: "full-metadata",
        quality: 1,
        cacheReadTokens: 10,
        cacheWriteTokens: 2,
        uncachedInputTokens: 20,
        eligiblePrefixTokens: 40,
        firstDifferentSection: "active-turn",
        billedCost: 100,
      },
      {
        arm: "short-ref",
        quality: 0,
        cacheReadTokens: 40,
        cacheWriteTokens: 0,
        uncachedInputTokens: 5,
        eligiblePrefixTokens: 80,
        firstDifferentSection: "active-turn",
        billedCost: 10,
      },
    ]);
    expect(blocked.qualityHardGate).toBe(false);
    expect(blocked.winner).toBeNull();
    const passed = compareCacheLayouts([
      {
        arm: "full-metadata",
        quality: 1,
        cacheReadTokens: 10,
        cacheWriteTokens: 2,
        uncachedInputTokens: 20,
        eligiblePrefixTokens: 40,
        firstDifferentSection: "hard-directives",
        billedCost: 100,
      },
      {
        arm: "directory-first",
        quality: 1,
        cacheReadTokens: 50,
        cacheWriteTokens: 1,
        uncachedInputTokens: 8,
        eligiblePrefixTokens: 90,
        firstDifferentSection: "directory",
        billedCost: 40,
      },
    ]);
    expect(passed.qualityHardGate).toBe(true);
    expect(passed.winner).toBe("directory-first");
  });
});
