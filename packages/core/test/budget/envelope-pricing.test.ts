import { describe, expect, it } from "vitest";

import { createRuntimeCursor } from "../../src/identity/index.js";
import { estimateMessageTokens, estimateTextTokens } from "../../src/budget/pricer.js";
import {
  envelopeFromRaw,
  priceEnvelope,
  priceRawPayload,
  serializedEnvelopeText,
} from "../../src/budget/envelope.js";

describe("envelope-aware serialized payload pricing", () => {
  it("round-trips wrap-shaped raw payloads to the same token price", () => {
    const raw = {
      role: "compactionSummary",
      summary: "do not deploy production tonight keep the rollback plan",
      tokensBefore: 6000,
    };
    const envelope = envelopeFromRaw(raw);
    const text = serializedEnvelopeText(envelope);
    expect(text).toContain("do not deploy production tonight");
    expect(priceEnvelope([envelope])).toBe(estimateTextTokens(text));
    expect(priceRawPayload(raw)).toBe(priceEnvelope([envelopeFromRaw(raw)]));
  });

  it("prices opaque compactionSummary/thinking/toolCall fields that normalized HostMessage drops", () => {
    const raw = {
      role: "assistant",
      thinking: "need to inspect the failing job before retrying the deploy",
      content: [
        { type: "thinking", thinking: "hidden chain of thought about secrets" },
        { type: "toolCall", id: "call_1", name: "bash", arguments: { command: "cat /etc/hosts" } },
      ],
    };
    const priced = priceEnvelope([envelopeFromRaw(raw)]);
    const normalizedOnly = estimateMessageTokens({
      hostMessageId: "hm-opaque",
      role: "assistant",
      timestamp: 1,
      sourceClass: "agent-derived",
      content: [],
    });
    expect(priced).toBeGreaterThan(normalizedOnly);
    expect(serializedEnvelopeText(envelopeFromRaw(raw))).toContain("cat /etc/hosts");
  });

  it("does not drop a huge active turn when pricing the raw envelope", () => {
    const huge = `keep this entire user turn ${"x".repeat(20_000)}`;
    const priced = priceEnvelope([{ role: "user", content: huge }]);
    expect(priced).toBeGreaterThan(estimateTextTokens("keep this entire user turn"));
    expect(priced).toBe(estimateTextTokens(`user\n${huge}`));
  });

  it("prices toolResult metadata and image payloads", () => {
    const raw = {
      role: "toolResult",
      toolCallId: "call_9",
      details: { exitCode: 1, stderr: "permission denied on /secret" },
      image: { mediaType: "image/png", bytes: 1200 },
      content: [{ type: "text", text: "failed" }],
    };
    const text = serializedEnvelopeText(envelopeFromRaw(raw));
    expect(text).toContain("permission denied on /secret");
    expect(priceEnvelope([envelopeFromRaw(raw)])).toBeGreaterThan(estimateTextTokens("failed"));
  });

  it("does not invent a workspace from createRuntimeCursor in the pricer path", () => {
    const bound = createRuntimeCursor({
      workspacePath: "/tmp/pcr-envelope",
      sessionId: "session-envelope",
      leafId: "leaf-envelope",
      lineageEntryIds: ["root", "leaf-envelope"],
      modelKey: "openclaw/Qwen3.8-27B-WORK",
    });
    expect(bound.workspaceId.startsWith("ws_")).toBe(true);
    expect(priceEnvelope([envelopeFromRaw({ role: "user", content: "hi" })])).toBeGreaterThan(0);
  });
});
