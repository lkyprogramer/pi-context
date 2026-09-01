import { describe, expect, it } from "vitest";
import {
  PI_DEFAULT_KEEP_RECENT,
  LIVE_RESERVE_TOKENS,
  assertNaturalThresholdPolicy,
  assertOverflowPolicy,
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
});
