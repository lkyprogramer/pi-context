import { describe, expect, it } from "vitest";

import { createRuntimeCursor, estimateTextTokens } from "@pcr/core";
import {
  buildRecursiveLaneHistory,
  evaluateW5Gate,
  runFaultSecurity,
  runNaturalThreshold,
  runOverflowProgress,
  runPerformanceCache,
  runRecursivePins,
} from "@pcr/benchmark";

describe("W5 natural / overflow / recursive / fault / performance / gate", () => {
  it("rejects no-trigger, early trigger, and keepRecent on natural threshold", async () => {
    expect((await runNaturalThreshold({ tokensBefore: 190_000, compactReason: "threshold", triggered: false })).ok).toBe(false);
    expect((await runNaturalThreshold({ tokensBefore: 6_200, compactReason: "threshold", triggered: true })).ok).toBe(false);
    expect((await runNaturalThreshold({
      tokensBefore: 190_000,
      compactReason: "threshold",
      triggered: true,
      keepRecent: 2_000,
    })).reason).toBe("keepRecent");
    expect((await runNaturalThreshold({ tokensBefore: 190_000, compactReason: "threshold", triggered: true })).ok).toBe(true);
  });

  it("requires overflow retries to change hash and strictly drop tokens", async () => {
    const stuck = await runOverflowProgress({
      prompt: "overflow-stuck ".repeat(400),
      windowTokens: 8,
      maxRetries: 3,
      compact: (text) => ({ visibleText: text, tokensAfter: estimateTextTokens(text) }),
    });
    expect(stuck.ok).toBe(false);
    expect(stuck.fitted).toBe(false);
    expect(stuck.hashesChange).toBe(false);
    const progressed = await runOverflowProgress({
      prompt: "overflow-retry ".repeat(2_000),
      windowTokens: 400,
    });
    expect(progressed.retries.length).toBeGreaterThanOrEqual(2);
    expect(new Set(progressed.retries.map((row) => row.outputHash)).size).toBe(progressed.retries.length);
    expect(progressed.retries.every((row, index, all) => index === 0 || row.tokensAfter < all[index - 1]!.tokensAfter)).toBe(true);
    expect(progressed.ok).toBe(true);
  });

  it("drops superseded directives and blocks deploy side-effect replay", () => {
    const cursor = createRuntimeCursor({
      workspacePath: "/tmp/w5-recursive",
      sessionId: "s",
      leafId: "l",
      lineageEntryIds: ["root", "l"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const replay = runRecursivePins(buildRecursiveLaneHistory(cursor, { replayDeploy: true }));
    expect(replay.cycles).toBe(3);
    expect(replay.sideEffectGuard).toBe(false);
    const pins = runRecursivePins(buildRecursiveLaneHistory(cursor));
    expect(pins.activeKeys).toEqual(["version", "next-action"]);
    expect(pins.supersededDropped).toBe(true);
    expect(pins.sideEffectGuard).toBe(true);
    expect(pins.restarted).toBe(true);
  });

  it("retains fuzz seeds and reports zero critical leaks on linux/darwin", () => {
    for (const platform of ["linux", "darwin"] as const) {
      const report = runFaultSecurity({
        platform,
        fuzzSeeds: [7, 8, 9],
        leaks: ["sk-live"],
        surfaces: ["ok"],
        crashReplay: 1,
      });
      expect(report.critical).toBe(0);
      expect(report.crashReplay).toBe(1);
      expect(report.fuzzRetained).toBe(true);
      expect(report.platform).toBe(platform);
    }
  });

  it("shows warm cache cheaper, CJK denser than english, and tool schema cost", () => {
    const report = runPerformanceCache({
      coldTokens: 800,
      warmTokens: 120,
      english: "abcd",
      cjk: "你好世界",
      toolsJson: JSON.stringify({ tools: [{ name: "bash", parameters: { type: "object" } }] }),
    });
    expect(report.warmCheaper).toBe(true);
    expect(report.cjkDenser).toBe(true);
    expect(report.toolsCost).toBeGreaterThan(0);
    expect(report.layout).toBe("short-ref");
  });

  it("blocks missing lanes, stale commits, and family regressions", () => {
    const commit = "a".repeat(40);
    expect(evaluateW5Gate({
      commit,
      headCommit: commit,
      lanes: ["boundary"],
      bundles: { boundary: {} },
    }).reasons).toContain("missing-lane");
    expect(evaluateW5Gate({
      commit,
      headCommit: "b".repeat(40),
      lanes: ["boundary", "natural-threshold", "overflow", "recursive", "fault-security", "performance-cache"],
      bundles: {
        boundary: {},
        "natural-threshold": {},
        overflow: {},
        recursive: {},
        "fault-security": {},
        "performance-cache": {},
      },
    }).reasons).toContain("stale-commit");
    expect(evaluateW5Gate({
      commit,
      headCommit: commit,
      lanes: ["boundary", "natural-threshold", "overflow", "recursive", "fault-security", "performance-cache"],
      familyRegressions: ["temporal"],
      bundles: {
        boundary: {},
        "natural-threshold": {},
        overflow: {},
        recursive: {},
        "fault-security": {},
        "performance-cache": {},
      },
    }).decision).toBe("keep-pi-native");
  });

  it("derives integrity and publicationClaim from the actual lane objects", async () => {
    const commit = "a".repeat(40);
    const cursor = createRuntimeCursor({
      workspacePath: "/tmp/w5-gate",
      sessionId: "s",
      leafId: "l",
      lineageEntryIds: ["root", "l"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    const overflowFail = await runOverflowProgress({
      prompt: "overflow-stuck ".repeat(200),
      windowTokens: 4,
      maxRetries: 2,
      compact: (text) => ({ visibleText: text, tokensAfter: estimateTextTokens(text) }),
    });
    const leaking = evaluateW5Gate({
      commit,
      headCommit: commit,
      lanes: ["boundary", "natural-threshold", "overflow", "recursive", "fault-security", "performance-cache"],
      bundles: {
        boundary: { pairs: 90, clusters: 30, seeds: [0, 1, 2], failures: [] },
        "natural-threshold": { ok: true, reason: "threshold" },
        overflow: overflowFail,
        recursive: runRecursivePins(buildRecursiveLaneHistory(cursor)),
        "fault-security": { critical: 2, high: 0, crashReplay: 1, fuzzRetained: true, platform: "linux" },
        "performance-cache": { warmCheaper: true, cjkDenser: true, toolsCost: 1, layout: "short-ref" },
      },
    });
    expect(leaking.decision).toBe("stop");
    expect(leaking.publicationClaim).toBe(false);
    expect(leaking.reasons).toContain("integrity");

    const overflowOk = await runOverflowProgress({
      prompt: "overflow-retry ".repeat(2_000),
      windowTokens: 400,
    });
    const honest = evaluateW5Gate({
      commit,
      headCommit: commit,
      lanes: ["boundary", "natural-threshold", "overflow", "recursive", "fault-security", "performance-cache"],
      bundles: {
        boundary: { pairs: 90, clusters: 30, seeds: [0, 1, 2], failures: [] },
        "natural-threshold": { ok: true, reason: "threshold" },
        overflow: overflowOk,
        recursive: runRecursivePins(buildRecursiveLaneHistory(cursor)),
        "fault-security": runFaultSecurity({
          platform: "linux",
          fuzzSeeds: [1],
          leaks: ["sk-live"],
          surfaces: ["ok"],
          crashReplay: 1,
        }),
        "performance-cache": { warmCheaper: true, cjkDenser: true, toolsCost: 1, layout: "short-ref" },
      },
    });
    expect(honest.decision).toBe("keep-pi-native");
    expect(honest.publicationClaim).toBe(false);
    expect(honest.reasons).toContain("insufficient-net");
  });
});
