import { describe, expect, it } from "vitest";

import { computeEffectiveInput, createRuntimeCursor, createTokenPricer, estimateTextTokens, reservesFromPayload } from "@pcr/core";
import { createTokenUsageProvenance } from "../../packages/kernel/src/control/economics.js";
import { reconcileUsage } from "../../packages/runtime/src/telemetry/usage.js";

function cursor() {
  return createRuntimeCursor({
    workspacePath: "/tmp/pcr-token-accounting",
    sessionId: "session-token",
    leafId: "leaf-token",
    lineageEntryIds: ["root", "leaf-token"],
    modelKey: "openclaw/Qwen3.8-27B-WORK",
  });
}

describe("token accounting", () => {
  it("prices CJK denser than latin and ignores hostMessageId as a fingerprint", async () => {
    const bound = cursor();
    const pricer = createTokenPricer({
      cursor: bound,
      routes: {
        "openclaw/Qwen3.8-27B-WORK": {
          modelKey: "openclaw/Qwen3.8-27B-WORK",
          contextWindow: 200192,
          maxOutputTokens: 16384,
          providerReservedTokens: 0,
        },
      },
    });
    expect(estimateTextTokens("你好世界")).toBeGreaterThan(estimateTextTokens("abcd"));
    const short = await pricer.priceMessage({
      hostMessageId: "shared-id",
      role: "user",
      timestamp: 1,
      sourceClass: "authenticated-user",
      content: [{ type: "text", text: "x" }],
    }, { modelKey: "openclaw/Qwen3.8-27B-WORK", cursor: bound });
    const long = await pricer.priceMessage({
      hostMessageId: "shared-id",
      role: "user",
      timestamp: 1,
      sourceClass: "authenticated-user",
      content: [{ type: "text", text: "x".repeat(400) }],
    }, { modelKey: "openclaw/Qwen3.8-27B-WORK", cursor: bound });
    expect(long).toBeGreaterThan(short);
    expect(pricer.effectiveInput({
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      contextWindow: 128000,
      maxOutputTokens: 16000,
      providerReservedTokens: 2000,
    })).toBe(110000);
    const enlarged = reservesFromPayload({
      systemText: "system",
      toolsJson: JSON.stringify({ tools: [{ name: "a" }, { name: "b", schema: "x".repeat(400) }] }),
      reasoningText: "think ".repeat(20),
      imageBlocks: 1,
    });
    const shrunk = computeEffectiveInput({
      modelKey: "openclaw/Qwen3.8-27B-WORK",
      contextWindow: 128000,
      maxOutputTokens: 16000,
      providerReservedTokens: 2000,
      ...enlarged,
    });
    expect(shrunk).toBeLessThan(110000);
    expect(enlarged.toolsTokens).toBeGreaterThan(0);
    expect(enlarged.reasoningTokens).toBeGreaterThan(0);
  });

  it("keeps provider reserve/cache token provenance explicit", () => {
    const host = createTokenUsageProvenance({
      serializedInputTokens: 120,
      providerReservedTokens: 24,
      providerUsage: { inputTokens: 40, cacheReadTokens: 80, cacheWriteTokens: 5, outputTokens: 12 },
    });
    expect(host.providerReservedTokens).toEqual({ value: 24, source: "host" });
    expect(host.cacheReadTokens).toEqual({ value: 80, source: "host" });
    expect(host.cacheWriteTokens).toEqual({ value: 5, source: "host" });
    expect(host.outputTokens).toEqual({ value: 12, source: "host" });

    const assistantEntry = createTokenUsageProvenance({
      serializedInputTokens: 120,
      providerUsage: { cacheReadTokens: 100 },
      providerUsageSource: "assistant-entry",
      cacheHit: true,
    });
    expect(assistantEntry.cacheReadTokens).toEqual({ value: 100, source: "assistant-entry" });
    expect(assistantEntry.cacheWriteTokens).toEqual({ value: null, source: "unavailable" });
    expect(assistantEntry.uncachedInputTokens).toEqual({ value: null, source: "unavailable" });

    const unknown = createTokenUsageProvenance({ serializedInputTokens: 120 });
    expect(unknown.providerReservedTokens).toEqual({ value: null, source: "unavailable" });
    expect(unknown.cacheReadTokens).toEqual({ value: null, source: "unavailable" });
    expect(unknown.cacheWriteTokens).toEqual({ value: null, source: "unavailable" });
    expect(unknown.outputTokens).toEqual({ value: null, source: "unavailable" });
    expect(unknown.totalBilledTokens).toEqual({ value: null, source: "unavailable" });
  });

  it("preserves per-field host versus assistant-entry provenance", () => {
    const usage = reconcileUsage({
      serializedInputTokens: 120,
      cacheHit: true,
      overflowRetry: false,
      provider: { inputTokens: 20, cacheReadTokens: 100 },
      providerUsageSources: { inputTokens: "host", cacheReadTokens: "assistant-entry" },
    });
    expect(usage.tokenProvenance.uncachedInputTokens).toEqual({ value: 20, source: "host" });
    expect(usage.tokenProvenance.cacheReadTokens).toEqual({ value: 100, source: "assistant-entry" });
    expect(usage.tokenProvenance.cacheWriteTokens).toEqual({ value: null, source: "unavailable" });
    expect(usage.tokenProvenance.outputTokens).toEqual({ value: null, source: "unavailable" });
  });
});
