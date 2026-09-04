import { describe, expect, it } from "vitest";
import {
  PI_DEFAULT_KEEP_RECENT,
  LIVE_RESERVE_TOKENS,
  assertNaturalThresholdPolicy,
  assertOverflowPolicy,
  evaluateBranchLineage,
  evaluateForkLineage,
  isContextOverflowError,
} from "./w5-live-lanes.js";

describe("W5 long-horizon lane policy", () => {
  it("rejects lowered keepRecent/reserve, hand compact, and fake liveProvider", () => {
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: 2_000,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount: 0,
      triggered: false,
      liveProvider: false,
      providerStarted: false,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_KEEP_RECENT_LOWERED" }));
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: 1_024,
      manualCompact: false,
      compactCount: 0,
      triggered: false,
      liveProvider: false,
      providerStarted: false,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_RESERVE_LOWERED" }));
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: true,
      compactCount: 1,
      triggered: true,
      liveProvider: true,
      providerStarted: true,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_MANUAL_COMPACT" }));
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount: 0,
      triggered: true,
      liveProvider: true,
      providerStarted: true,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_TRIGGER_WITHOUT_COMPACT" }));
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount: 0,
      triggered: false,
      liveProvider: true,
      providerStarted: false,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_FAKE_LIVE_PROVIDER" }));
    expect(() => assertNaturalThresholdPolicy({
      keepRecentTokens: PI_DEFAULT_KEEP_RECENT,
      reserveTokens: LIVE_RESERVE_TOKENS,
      manualCompact: false,
      compactCount: 0,
      triggered: false,
      liveProvider: false,
      providerStarted: false,
    })).not.toThrow();
  });

  it("rejects treating a hand compact as provider overflow recovery", () => {
    expect(() => assertOverflowPolicy({
      overflowObserved: false,
      usedManualCompactAsOverflow: true,
      hashesChange: true,
      tokensStrictlyDecrease: true,
    })).toThrowError(expect.objectContaining({ code: "PCR_W5_OVERFLOW_HAND_COMPACT" }));
    expect(isContextOverflowError("context_length_exceeded: prompt is too long")).toBe(true);
    expect(isContextOverflowError("provider timeout")).toBe(false);
  });

  it("requires a real parent and sibling branch before accepting restart continuity", () => {
    const entries = [
      { id: "root", parentId: null },
      { id: "front", parentId: "root" },
      { id: "u-branch", parentId: "root", timestamp: "2026-09-04T00:00:00.000Z" },
    ];
    expect(evaluateBranchLineage(entries).ok).toBe(true);
    expect(evaluateBranchLineage(entries.slice(0, 2)).ok).toBe(false);
    expect(evaluateBranchLineage([
      { id: "root", parentId: null },
      { id: "u-branch", parentId: "missing", timestamp: "2026-09-04T00:00:00.000Z" },
    ]).parentExists).toBe(false);
    expect(evaluateBranchLineage([
      { id: "root", parentId: null },
      { parentId: "root" },
      { id: "u-branch", parentId: "root" },
    ]).isSibling).toBe(false);
    expect(evaluateBranchLineage([
      { id: "root", parentId: null },
      { id: "front", parentId: "root" },
      { id: "u-branch", parentId: "root" },
      { id: "tail", parentId: "u-branch" },
    ]).restartHeadPresent).toBe(false);
  });

  it("accepts fork lineage only when the new session points to the source", () => {
    const source = [
      { type: "session", id: "source", parentSession: undefined },
      { id: "root", parentId: null },
      { id: "front", parentId: "root" },
    ];
    const fork = [
      { type: "session", id: "fork", parentSession: "/tmp/source.jsonl" },
      { id: "root", parentId: null },
      { id: "branch", parentId: "root" },
      { id: "assistant", parentId: "branch" },
    ];
    expect(evaluateForkLineage(source, fork, "/tmp/source.jsonl", "branch").ok).toBe(true);
    expect(evaluateForkLineage(source, fork, "/tmp/other.jsonl", "branch").ok).toBe(false);
  });
});
