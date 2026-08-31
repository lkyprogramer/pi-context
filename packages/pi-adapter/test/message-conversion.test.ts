import { describe, expect, it } from "vitest";
import { toHostMessages, toPiMessages } from "../src/message-conversion.js";

describe("message conversion", () => {
  it("keeps assistant content as text blocks so Pi transformMessages can flatMap", () => {
    const host = toHostMessages([
      { role: "user", content: "ask" },
      { role: "assistant", content: [{ type: "text", text: "ACK" }] },
    ]);
    const pi = toPiMessages(host);
    expect(pi[0]).toMatchObject({ role: "user", content: "ask" });
    expect(pi[1]).toMatchObject({
      role: "assistant",
      content: [{ type: "text", text: "ACK" }],
    });
    expect(Array.isArray((pi[1] as { content: unknown }).content)).toBe(true);
  });

  it("preserves thinking blocks on assistant messages", () => {
    const host = toHostMessages([
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "scratch" }, { type: "text", text: "ACK" }],
      },
    ]);
    const pi = toPiMessages(host);
    expect(pi[0]?.content).toEqual([
      { type: "thinking", thinking: "scratch" },
      { type: "text", text: "ACK" },
    ]);
  });

  it("maps Pi toolResult to host tool-result and back without becoming custom", () => {
    const host = toHostMessages([
      { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "ok" }] },
    ]);
    expect(host[0]).toMatchObject({ role: "tool-result", toolCallId: "call_1" });
    expect(toPiMessages(host)[0]).toMatchObject({ role: "toolResult", content: "ok", toolCallId: "call_1" });
  });

  it("does not invent zero usage on rematerialized assistant messages", () => {
    const pi = toPiMessages([
      {
        hostMessageId: "m1",
        role: "assistant",
        timestamp: 1,
        sourceClass: "agent-derived",
        content: [{ type: "text", text: "ACK" }],
      },
    ]);
    expect(pi[0]?.usage).toBeUndefined();
  });

  it("labels tool-result as untrusted-tool by default", () => {
    const host = toHostMessages([
      { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "ok" }] },
    ]);
    expect(host[0]?.sourceClass).toBe("untrusted-tool");
  });

  it("maps tool-result to Pi toolResult without stringifying assistant history", () => {
    const pi = toPiMessages([
      {
        hostMessageId: "m1",
        role: "tool-result",
        timestamp: 1,
        sourceClass: "trusted-tool",
        toolCallId: "call_1",
        content: [{ type: "text", text: "ok" }],
      },
    ]);
    expect(pi[0]).toMatchObject({ role: "toolResult", content: "ok", toolCallId: "call_1" });
  });
});
