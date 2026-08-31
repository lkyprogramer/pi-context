import { describe, expect, it } from "vitest";

import { createPerformanceLaneRunner } from "@pcr/benchmark";

const MODEL = "openclaw/Qwen3.8-27B-WORK";
const ROUTE = {
  modelKey: MODEL,
  contextWindow: 200192,
  maxOutputTokens: 16384,
  providerReservedTokens: 0,
} as const;

function lanes() {
  return createPerformanceLaneRunner({
    workspaceId: "ws-perf",
    routes: { [MODEL]: ROUTE },
    cache: { async current() { return { eligiblePrefixTokens: 10 }; } },
    clone: { async measure() { return 8; } },
  });
}

describe("performance lanes", () => {
  it("does not treat a 6.2k compact as natural threshold when keepRecent is omitted", async () => {
    await expect(lanes().measure({
      lane: "natural-threshold",
      workspaceId: "ws-perf",
      sessionId: "s1",
      modelKey: MODEL,
      tokensBefore: 6_200,
      tokensAfter: 2_000,
      compactReason: "threshold",
      promptTokens: 6_200,
      hookMs: [1],
    })).rejects.toMatchObject({ code: "PCR_PERFORMANCE_INPUT_INVALID", details: { field: "tokensBefore" } });
  });

  it("rejects keepRecent:2000 even when tokens fill the host window", async () => {
    await expect(lanes().measure({
      lane: "natural-threshold",
      workspaceId: "ws-perf",
      sessionId: "s1",
      modelKey: MODEL,
      tokensBefore: 190_000,
      tokensAfter: 12_000,
      compactReason: "threshold",
      promptTokens: 80_000,
      hookMs: [1],
      keepRecent: 2_000,
    })).rejects.toMatchObject({ code: "PCR_PERFORMANCE_INPUT_INVALID", details: { field: "keepRecent" } });
  });
});
