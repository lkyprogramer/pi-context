import { describe, expect, it } from "vitest";

import { createRuntimeCursor, createTokenPricer, estimateTextTokens } from "@pcr/core";

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
  });
});
