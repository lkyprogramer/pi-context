import { describe, expect, it } from "vitest";

import { createPerformanceLaneRunner } from "@pcr/benchmark";
import { countSideEffectEvents, isContextLengthError, runForcedOverflowRecovery } from "../live-gate/forced-overflow-provider.js";

const MODEL = "openclaw/Qwen3.8-27B-WORK";
const ROUTE = {
  modelKey: MODEL,
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;

describe("provider overflow lane", () => {
  it("counts unique mutating tool calls instead of trusting a synthetic zero", () => {
    expect(countSideEffectEvents([
      { type: "tool_call", toolCallId: "w1", toolName: "write", args: { path: "a" } },
      { type: "tool_result", toolCallId: "w1", toolName: "write", args: { path: "a" } },
      { type: "tool_call", toolCallId: "r1", toolName: "read", args: { path: "a" } },
      { type: "tool_call", toolCallId: "d1", toolName: "bash", args: { command: "deploy production" } },
    ])).toBe(2);
  });

  it("classifies context overflow and retries once without side effects", async () => {
    const report = await runForcedOverflowRecovery({
      force: () => ({ phase: "force", ok: false, error: "context_length_exceeded: prompt is too long", sideEffectCount: 1 }),
      compact: () => ({ phase: "compact", ok: true, tokensAfter: 100, outputHash: "compact", sideEffectCount: 1 }),
      retry: () => ({ phase: "retry", ok: true, tokensAfter: 20, outputHash: "retry", sideEffectCount: 1 }),
    });
    expect(report.prevention).toEqual({ overflowObserved: true, errorClass: "context-length" });
    expect(report.recovery).toMatchObject({ compacted: true, retried: true, sideEffectsUnchanged: true, ok: true });
    expect(report.attempts.map((row) => row.phase)).toEqual(["force", "compact", "retry"]);
    expect(isContextLengthError("provider timeout")).toBe(false);
  });

  it("fails closed when retry changes side-effect count", async () => {
    const report = await runForcedOverflowRecovery({
      force: () => ({ phase: "force", ok: false, error: "maximum context window exceeded", sideEffectCount: 2 }),
      compact: () => ({ phase: "compact", ok: true, sideEffectCount: 2 }),
      retry: () => ({ phase: "retry", ok: true, sideEffectCount: 3 }),
    });
    expect(report.recovery.ok).toBe(false);
    expect(report.recovery.sideEffectsUnchanged).toBe(false);
  });
  it("rejects overflow claims that never exceeded the provider window", async () => {
    const lanes = createPerformanceLaneRunner({
      workspaceId: "ws-fault",
      routes: { [MODEL]: ROUTE },
      cache: { async current() { return { eligiblePrefixTokens: 0 }; } },
      clone: { async measure() { return 1; } },
    });
    await expect(lanes.measure({
      lane: "provider-overflow",
      workspaceId: "ws-fault",
      sessionId: "s1",
      modelKey: MODEL,
      tokensBefore: 6_200,
      tokensAfter: 6_200,
      compactReason: "overflow",
      promptTokens: 6_200,
      hookMs: [2],
    })).rejects.toMatchObject({ code: "PCR_PERFORMANCE_INPUT_INVALID" });
  });
});
