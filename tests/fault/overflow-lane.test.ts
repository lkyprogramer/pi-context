import { describe, expect, it } from "vitest";

import { createPerformanceLaneRunner } from "@pcr/benchmark";

const MODEL = "openclaw/Qwen3.8-27B-WORK";
const ROUTE = {
  modelKey: MODEL,
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;

describe("provider overflow lane", () => {
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
