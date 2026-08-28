import { describe, expect, it } from "vitest";
import { stitchContextMessages } from "../../packages/pi-adapter/src/context-hook.js";
import { toHostMessages, toPiMessages } from "../../packages/pi-adapter/src/message-conversion.js";
import { createPiHarnessWithRuntime } from "../support/pi.js";

function fixturePiMessages() {
  return [
    { role: "user", content: "first" },
    { role: "assistant", content: "ok" },
    { role: "user", content: "now" },
  ];
}

describe("Pi context hook", () => {
  it("returns materialized messages before convertToLlm and aborts on hard safety failure", async () => {
    const host = await createPiHarnessWithRuntime({ materializeError: "PCR_DIRECTIVE_BUDGET_EXCEEDED" });
    const messages = await host.emitContext(fixturePiMessages());
    expect(host.abortCalls).toBe(1);
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("does not let a handler exception escape the hook", async () => {
    const host = await createPiHarnessWithRuntime({
      materializeError: "PCR_DIRECTIVE_BUDGET_EXCEEDED",
    });
    await expect(host.emitContext(fixturePiMessages())).resolves.toEqual(expect.any(Array));
  });

  it("converts custom, compaction, and branch summaries to agent-derived custom messages", () => {
    const host = toHostMessages([
      { role: "custom", content: "aside" },
      { role: "compaction", content: "summary" },
      { role: "branch-summary", content: "fork" },
    ]);
    expect(host.every((item) => item.role === "custom")).toBe(true);
    expect(host.every((item) => item.sourceClass === "agent-derived")).toBe(true);
    expect(toPiMessages(host).map((item) => item.role)).toEqual(["custom", "custom", "custom"]);
  });

  it("keeps Pi compactionSummary when emitting a post-compact context", async () => {
    const host = await createPiHarnessWithRuntime();
    const messages = await host.emitContext([
      { role: "compactionSummary", summary: "do not deploy prod", tokensBefore: 6000 },
      { role: "user", content: "should we deploy?" },
    ]);
    expect(messages[0]).toMatchObject({ role: "compactionSummary", summary: "do not deploy prod", tokensBefore: 6000 });
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("keeps the original user last after a successful materialization", async () => {
    const host = await createPiHarnessWithRuntime();
    const messages = await host.emitContext(fixturePiMessages());
    expect(host.abortCalls).toBe(0);
    expect(messages.at(-1)?.role).toBe("user");
  });

  it("passes Pi compactionSummary through so convertToLlm keeps the native wrapper", () => {
    const original = [
      { role: "compactionSummary", summary: "do not deploy prod", tokensBefore: 6000, timestamp: 1 },
      { role: "user", content: "should we deploy?" },
    ];
    const converted = toPiMessages(toHostMessages([{ role: "user", content: "should we deploy?" }]));
    const stitched = stitchContextMessages(original, converted);
    expect(stitched[0]).toMatchObject({ role: "compactionSummary", summary: "do not deploy prod", tokensBefore: 6000 });
    expect(stitched[1]).toMatchObject({ role: "user", content: "should we deploy?" });
  });

  it("passes thinking-only assistants through without stripping usage", () => {
    const original = [
      {
        role: "assistant",
        content: [{ type: "thinking", thinking: "scratch" }],
        usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "length",
      },
    ];
    const stitched = stitchContextMessages(original, [{ role: "assistant", content: [{ type: "text", text: "" }] }]);
    expect(stitched[0]).toBe(original[0]);
  });

  it("passes toolResult through so Pi keeps tool pairing and usage", () => {
    const original = [
      {
        role: "assistant",
        content: [{ type: "toolCall", id: "call_1", name: "context_status", arguments: {} }],
        usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "toolUse",
      },
      { role: "toolResult", toolCallId: "call_1", content: [{ type: "text", text: "{\"ok\":true}" }] },
      { role: "user", content: "continue" },
    ];
    const converted = toPiMessages(toHostMessages([{ role: "user", content: "continue" }]));
    const stitched = stitchContextMessages(original, converted);
    expect(stitched[0]).toBe(original[0]);
    expect(stitched[1]).toMatchObject({ role: "toolResult", toolCallId: "call_1" });
    expect(stitched[0]?.usage?.totalTokens).toBe(11);
  });

  it("never rematerializes an assistant without usage.totalTokens", () => {
    const original = [{ role: "assistant", content: [{ type: "text", text: "ACK" }], stopReason: "stop" }];
    const converted = [{ role: "assistant", content: [{ type: "text", text: "ACK" }] }];
    expect(stitchContextMessages(original, converted)[0]?.usage?.totalTokens).toBe(0);
  });

  it("restores assistant usage after rematerialization", () => {
    const original = [
      {
        role: "assistant",
        content: [{ type: "text", text: "ACK" }],
        usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
      },
    ];
    const converted = [{ role: "assistant", content: [{ type: "text", text: "ACK" }] }];
    expect(stitchContextMessages(original, converted)[0]).toMatchObject({
      usage: { totalTokens: 11 },
      stopReason: "stop",
    });
  });

  it("labels unsupported custom content as agent-derived", () => {
    const [converted] = toHostMessages([{ role: "unknown-plugin", content: { weird: true } }]);
    expect(converted?.role).toBe("custom");
    expect(converted?.sourceClass).toBe("agent-derived");
  });
});
